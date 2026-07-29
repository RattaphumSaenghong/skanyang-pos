# Bay Allocations Code Review

**Date:** 2026-07-28  
**Review type:** Full working-tree review  
**Implementation changes made:** None  
**Verdict:** **Not ready to deploy without resolving the high-severity findings**

## Executive summary

The feature has a good basic shape: the allocation rules are pure and tested, Bangkok day boundaries are handled explicitly, shop scoping is centralized, service names and durations are snapshotted, and a partial unique index protects a bay from holding two different in-progress jobs.

The main risks are at the seams between those pieces:

1. `Service.requiresBay` has no runtime effect, although the settings UI presents it as operational behavior.
2. Bay-job state transitions are checked and written in separate database operations, so concurrent requests can bypass the state machine.
3. Booking overlap checks are also read-then-write and can accept two concurrent bookings for the same bay and time.
4. Bay deactivation can bypass its occupancy guard through the PATCH endpoint.
5. The “soonest available bay” ETA is calculated but discarded before it reaches the UI.

There are also migration/production-seeding gaps, validation gaps, an overnight booking-overlap edge case, and two inconsistencies in the adjacent customer-display change.

## Scope reviewed

I reviewed all 29 files in the Bay Allocations feature boundary:

- API registration:
  - `apps/api/src/app/app.module.ts`
- Bay API:
  - `apps/api/src/bays/allocation.ts`
  - `apps/api/src/bays/allocation.spec.ts`
  - `apps/api/src/bays/tz.ts`
  - `apps/api/src/bays/tz.spec.ts`
  - `apps/api/src/bays/bays.module.ts`
  - `apps/api/src/bays/bays.controller.ts`
  - `apps/api/src/bays/bays.service.ts`
  - `apps/api/src/bays/bay-jobs.controller.ts`
  - `apps/api/src/bays/bay-jobs.service.ts`
  - all four DTO files under `apps/api/src/bays/dto/`
- Shared shop scope:
  - `apps/api/src/common/shop-scope.ts`
- Service catalog API:
  - all five files under `apps/api/src/service-catalog/`
- API test configuration:
  - `apps/api/vitest.config.mts`
- Web UI and routing:
  - `apps/web/src/app/app.tsx`
  - `apps/web/src/components/Layout.tsx`
  - `apps/web/src/pages/bays/BayBoardPage.tsx`
  - `apps/web/src/pages/settings/BaysSettingsPage.tsx`
- Adjacent customer-display change:
  - `apps/web/src/pages/display/CustomerDisplayPage.tsx`
- Database:
  - `prisma/schema.prisma`
  - `prisma/seed.ts`
  - `prisma/migrations/20260728120000_add_bay_allocation/migration.sql`

Unrelated working-tree files such as `.claude/launch.json`, the quotation handoff, and the tax-reconciliation PRD were not treated as Bay Allocations implementation.

## Findings

### BA-01 — High — `requiresBay` is a dead setting

**Evidence**

- The field is stored in `prisma/schema.prisma:384`.
- The settings UI lets the owner edit it in `apps/web/src/pages/settings/BaysSettingsPage.tsx:477-480`.
- Catalog services are resolved in `apps/api/src/bays/bay-jobs.service.ts:52-73`, but only `id`, `name`, and `estimatedMinutes` are read.
- Every walk-in enters `WAITING` in `apps/api/src/bays/bay-jobs.service.ts:142-145`.
- Every waiting job must then be assigned to a bay through the same allocation flow.
- Repository-wide search found no runtime read of `requiresBay` outside catalog CRUD and UI display.

**Impact**

A service configured as “does not require a bay,” such as the seeded “เติมลม / ตรวจเช็ค,” behaves exactly like a bay-required service. A job containing only non-bay services still waits for and occupies a physical bay. The owner-facing toggle is therefore misleading and cannot influence capacity.

For mixed jobs, the code also has no rule such as “requires a bay if any selected service requires one.”

**Recommended decision**

Define the lifecycle for all-non-bay jobs and mixed jobs, then represent that decision in the job snapshot or derived job data. Until then, either remove/hide the setting or treat the feature as incomplete.

---

### BA-02 — High — State transitions are not atomic

**Evidence**

Each transition:

1. loads the job with `findFirst`,
2. checks `canTransition`,
3. later updates using only `where: { id }`.

Examples:

- Assign: `apps/api/src/bays/bay-jobs.service.ts:242-269`
- Check-in: `apps/api/src/bays/bay-jobs.service.ts:228-239`
- Complete: `apps/api/src/bays/bay-jobs.service.ts:272-283`
- Cancel/no-show: `apps/api/src/bays/bay-jobs.service.ts:286-299`

The partial unique index in the migration protects two different jobs from occupying the same bay, but it does not protect the same job from two concurrent transitions.

**Reproducible race**

1. Two tablets read the same job as `WAITING`.
2. Tablet A assigns it to bay 1.
3. Tablet B assigns it to bay 2 before seeing A's refresh.
4. Both pre-checks pass; both updates target only the job ID.
5. The last write wins. Staff can physically start the car in bay 1 while the database now says bay 2.

Similar stale-state races exist between check-in and no-show, or between assignment and cancellation.

**Impact**

The database can accept a transition that is illegal from the job's actual current state, and optimistic UI can briefly direct staff to the wrong bay.

**Recommended direction**

Make transitions compare-and-set operations that include the expected current status in the write, and treat a zero-row update as a conflict. Keep the partial unique index for the separate “two jobs, one bay” race.

---

### BA-03 — High — Concurrent booking creation can double-book a bay

**Evidence**

- `assertNoBookingClash` reads candidate bookings in `apps/api/src/bays/bay-jobs.service.ts:100-131`.
- Creation calls the check in `apps/api/src/bays/bay-jobs.service.ts:153-154`.
- The actual insert happens afterward in `apps/api/src/bays/bay-jobs.service.ts:157-175`.
- The migration has a partial unique constraint for `IN_PROGRESS` bay occupancy, but no database constraint or lock for booking time ranges (`migration.sql:104-110`).

**Reproducible race**

Two concurrent requests for the same bay and time both query before either inserts. Both see no clash and both create a `BOOKED` job.

The same issue applies when a booking's service duration is extended: the clash check and update are separate operations.

**Impact**

The feature's central promise—one reservation slot per bay—does not hold under concurrent requests.

**Recommended direction**

Serialize booking writes per bay or enforce non-overlapping ranges at the database layer. A normal unique key on `scheduledAt` is not sufficient because durations create ranges.

---

### BA-04 — High — PATCH can deactivate an occupied bay and bypass the DELETE guard

**Evidence**

- `UpdateBayDto` exposes `active` in `apps/api/src/bays/dto/update-bay.dto.ts:13-15`.
- `BaysService.update` writes the DTO directly in `apps/api/src/bays/bays.service.ts:35-40`.
- The occupied-bay check exists only in `BaysService.delete` at `apps/api/src/bays/bays.service.ts:42-51`.

**Impact**

`PATCH /bays/:id` with `{ "active": false }` can deactivate a bay containing an `IN_PROGRESS` job, even though the DELETE endpoint explicitly rejects that operation.

The current UI uses DELETE to deactivate, but the API invariant is still bypassable by another client, an integration, or a future UI change.

**Recommended direction**

Have one server-side path for activation changes and enforce occupancy/future-booking rules there, regardless of which HTTP verb initiated the change.

---

### BA-05 — Medium — Deactivation ignores future bookings

**Evidence**

`BaysService.delete` checks only `IN_PROGRESS` jobs at `apps/api/src/bays/bays.service.ts:46-49`. It does not check `BOOKED` jobs.

Check-in changes a booking to `WAITING` without revalidating whether its reserved bay is still active (`apps/api/src/bays/bay-jobs.service.ts:228-239`).

**Impact**

An owner can deactivate a bay that still has future reservations. The booking list continues to name that bay. At check-in, the job retains the inactive `bayId`, while allocation silently falls back to another active bay if one is available.

That may be acceptable as an explicit reassignment workflow, but the UI neither warns the owner nor asks them to move affected bookings.

**Recommended decision**

Choose one behavior: block deactivation, require reassignment, or clearly mark affected bookings as needing reassignment.

---

### BA-06 — Medium — The soonest-free ETA feature never reaches the user

**Evidence**

- `suggestBay` calculates and returns `freeAt` when all eligible bays are busy in `apps/api/src/bays/allocation.ts:91-103`.
- `BaysService.getBoard` keeps only `.bayId` and discards `freeAt` at `apps/api/src/bays/bays.service.ts:138-151`.
- The web UI disables every occupied-bay button in `apps/web/src/pages/bays/BayBoardPage.tsx:787-805`.

**Impact**

When every bay is busy, the pure allocation engine successfully identifies the soonest available bay, but the board shows no ETA and no visible suggestion. This contradicts the allocation module's documented behavior.

**Recommended direction**

Return the full suggestion object and render a non-actionable “expected at HH:MM” indication for busy bays.

---

### BA-07 — Medium — Overnight booking overlaps are missed

**Evidence**

`assertNoBookingClash` fetches only bookings whose `scheduledAt` falls inside the new booking's Bangkok calendar day (`apps/api/src/bays/bay-jobs.service.ts:107-118`).

**Reproducible case**

- Existing booking: July 27 at 23:45, duration 30 minutes.
- New booking: July 28 at 00:00 in the same bay.
- The intervals overlap until 00:15, but the existing booking starts outside July 28's query window and is never compared.

**Impact**

The overlap invariant fails at a day boundary. If the shop never accepts near-midnight bookings, that operating-hours rule is not currently enforced anywhere.

**Recommended direction**

Query a window that includes any earlier booking that could still be running, or enforce shop hours that make the case impossible.

---

### BA-08 — Medium — Existing production shops receive bays but no default services

**Evidence**

- The migration backfills four bays for every existing shop in `migration.sql:112-119`.
- Default services exist only in `prisma/seed.ts:55-79`.
- A normal production `prisma migrate deploy` does not run the seed automatically.

**Impact**

Fresh seeded environments receive the catalog. Existing deployed shops receive bays but an empty catalog. Staff can still create ad-hoc services, but the advertised defaults will not appear unless someone separately runs the seed or configures them manually.

**Recommended decision**

Decide whether default services are production data or development/demo seed data. If they are production defaults, backfill them through a deployment-safe data migration.

---

### BA-09 — Medium — Request validation permits ambiguous or invalid operations

**Confirmed cases**

- Bay names use `@IsString` but not `@IsNotEmpty`, and are not trimmed:
  - `apps/api/src/bays/dto/create-bay.dto.ts:4-6`
  - `apps/api/src/bays/dto/update-bay.dto.ts:4-7`
- Plate number uses `@IsString` but not `@IsNotEmpty`:
  - `apps/api/src/bays/dto/create-bay-job.dto.ts:33-34`
- Booking timestamps are syntactically validated but may be in the past:
  - `apps/api/src/bays/dto/create-bay-job.dto.ts:57-59`
- The cancel body is an inline TypeScript shape, not a validated DTO:
  - `apps/api/src/bays/bay-jobs.controller.ts:69-76`

Because interfaces do not exist at runtime, `{ "noShow": "false" }` is truthy and will select `NO_SHOW` in `apps/api/src/bays/bay-jobs.service.ts:290`.

- Duplicate bay names are protected by the database, but `BaysService.create/update` do not translate Prisma `P2002` into a useful 409, unlike the service catalog.

**Impact**

Direct API callers can create whitespace-only identifiers, create past bookings, or accidentally mark a cancellation as no-show. Duplicate bay names can surface as generic server errors.

---

### BA-10 — Medium — Customer-display set detection is internally inconsistent

This file is adjacent to, rather than required by, Bay Allocations, but it is part of the same working-tree change and was reviewed.

**Evidence**

- Payment-row behavior treats an ordinary item whose quantity is not divisible by four as individual pricing:
  - `apps/web/src/pages/display/CustomerDisplayPage.tsx:50-59`
- The new badge and service-package condition treats every quantity `>= 4` as a set:
  - `apps/web/src/pages/display/CustomerDisplayPage.tsx:316`
  - `apps/web/src/pages/display/CustomerDisplayPage.tsx:376`

**Reproducible case**

An ordinary product with quantity 5 receives individual payment rows, but also gets the “ชุด 4 เส้น” badge and the Icare service-package promotion row.

**Impact**

The same quotation item is presented to the customer as both an individual-tire purchase and a four-tire set.

**Recommended direction**

Use one canonical set-pricing rule shared with quotation/checkout behavior. Do not infer it independently from `qty >= 4`.

---

### BA-11 — Medium — The new customer-display promotion row does not reconcile its columns

**Evidence**

The new row shows:

- normal price: 2,000
- promo discount: 2,000
- price per item: 2,000
- quantity: 1
- total: 0

See `apps/web/src/pages/display/CustomerDisplayPage.tsx:376-389`.

**Impact**

The displayed arithmetic does not reconcile: a fully discounted item would normally have a final unit price of 0, while a 2,000 unit price at quantity 1 implies a 2,000 total. This can confuse the customer even if the row is informational and is not persisted into quotation totals.

The code also adds exactly one service-package row regardless of how many qualifying sets are in the quotation. That may be intentional, but the policy is not encoded or documented.

---

### BA-12 — Medium — Core services and HTTP behavior have no integration tests

The 29 passing tests cover only:

- pure allocation helpers
- Bangkok date/time helpers

There are no tests for:

- state transitions
- concurrent assignment
- concurrent booking creation
- booking overlap queries
- shop scoping at controllers
- owner/staff authorization
- bay deactivation
- service resolution/snapshotting
- migration behavior
- API validation
- UI workflows or optimistic rollback

This is why the concurrency, deactivation, and `requiresBay` gaps pass the current suite.

---

### BA-13 — Low — Board polling performs an unused bookings query

`BaysService.getBoard` queries `bookingsToday` on every board poll (`apps/api/src/bays/bays.service.ts:79-95`) and returns it, but `BayBoardPage` fetches bookings again through `/bay-jobs/bookings` and renders that second result.

With a five-second poll interval, every client repeatedly loads booking data that it does not use.

---

### BA-14 — Low — Formatting is not clean

`npm exec nx format:check` failed. Most failures are feature files, including the bay services, DTOs, UI pages, app registration, customer display, Prisma seed, and test configuration.

There is no inferred Nx `lint` target for any project, so formatting and TypeScript are currently the main automated static checks.

## What is working well

- **Shop scoping:** `resolveShopId` correctly lets only the super-owner choose a requested shop; `SHOP_OWNER` and `STAFF` remain pinned to the shop loaded from the database-backed JWT strategy.
- **Authorization:** Bay and service-catalog writes are owner-only, while staff can use the board.
- **Historical integrity:** Job service names and durations are snapshotted, so catalog edits do not rewrite completed work.
- **Time-zone handling:** Bangkok day windows are explicit and correctly tested rather than relying on the API server's local time.
- **Basic allocation logic:** Inactive bays and walk-in use of booking-only bays are rejected; free bays and reserved booking bays are prioritized deterministically.
- **Different-job bay race:** The partial unique index correctly prevents two separate `IN_PROGRESS` jobs from occupying one bay.
- **Optimistic UI:** Board mutations preserve prior cache state and roll back after API errors.
- **Migration split for bays:** Existing shops receive bays from the migration; fresh seeded databases receive them from the seed.
- **Schema validity:** Prisma accepts the schema.

## Verification performed

### Passed

- `npm exec nx run @org/api:test`
  - 2 test files passed
  - 29 tests passed
- `npm exec nx run @org/api:build`
  - Webpack build passed
- `npm exec nx run @org/web:build`
  - Vite production build passed
- `npm exec prisma validate`
  - Schema valid
- `git diff --check`
  - No whitespace errors

### Failed or unavailable

- `@org/api:typecheck` failed on existing non-Bay files such as auth DTOs/JWT typing and Multer typing.
- `@org/web:typecheck` failed on existing non-Bay files:
  - `PosSearchPage.tsx`
  - `ProductsImportPage.tsx`
  - `SalesReportPage.tsx`
- No Bay file appeared in the reported TypeScript errors, but the repository as a whole is not typecheck-clean.
- `npm exec nx format:check` failed.
- No Nx lint target is configured.

## Suggested resolution order

1. Make job status transitions atomic.
2. Make booking overlap enforcement concurrency-safe.
3. Decide and implement the actual meaning of `requiresBay`.
4. Unify bay activation/deactivation invariants, including future bookings.
5. Carry `freeAt` through the board API and UI.
6. Fix the customer-display set predicate and promotional row arithmetic.
7. Close validation and overnight-overlap gaps.
8. Decide how production shops receive default services.
9. Add service/controller integration tests and concurrency tests.
10. Format the feature and restore a clean static-check baseline.

## Final assessment

The pure helper layer is solid, but the feature is not yet safe at the transactional boundaries where multiple staff devices operate concurrently. The highest-value next step is not more allocation heuristics; it is enforcing the existing state and booking rules atomically in the database-facing service layer.
