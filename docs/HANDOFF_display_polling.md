# Handoff — customer display polling reduction

**Branch/state:** uncommitted working-tree changes in `skanyang-pos`
**Date:** 2026-07-27
**Status:** implemented and **fully verified — all 8 tests pass.** No defects found. Ready to commit.
Two pre-existing bugs were found along the way (see "Found while testing"); neither is caused by this
change. Remaining work is the commit itself and the reload-every-display deploy step.

---

## Why this change exists

One shop was generating ~50,000 API requests/day. ~95% of it traced to `CustomerDisplayPage`
— the customer-facing second monitor at each staff station.

The staff POS and the customer display are two separate browsers that can't talk to each other,
so the API is used as a mailbox: staff **writes** display state on click, the display **polls** to
find out. The display had grown three independent polling loops, one per rendered layer:

| Loop | Was | req/hr |
|---|---|---|
| `GET /display/:shopId/:staffId/state` | 3s | 1,200 |
| `GET /display/:shopId/:staffId/search-results` | 3s | 1,200 |
| `GET /display/:shopId/images` | 8s | 450 |
| | | **2,850/hr per open screen** |

`/display/:shopId/:staffId` is routed **per staff member**, so two staff = two screens =
~57,000 req/day. That reproduces the reported number.

Hit rate was the real problem: display state changes ~240×/day but was polled ~12,000×.
Banner images change ~monthly but were polled 4,500×/day.

**Fix:** collapse the three loops into one `/snapshot` endpoint at the same 3s interval.
Expected: **2,850 → 1,200 req/hr per screen**; two screens on a 10h day **57,000 → 24,000/day**.

Poll interval deliberately stayed at 3s — that's the perceived-latency budget for
"staff clicks show → customer sees it". No UX regression intended.

---

## What changed

### `apps/api/src/display/display.service.ts`
- **New `getSnapshot(shopId, staffId?)`** returns `{mode, quotation, promoTextMichelin,
  promoTextBfGoodrich, searchResults, images}` in one payload. Resolves the active quotation from
  `staffQuotationCache` when `staffId` is present, else from `shop.activeDisplayQuotationId`.
  Keeps the existing auto-clear on `CONVERTED`/`CANCELLED`.
- **N+1 killed.** `getStaffState` and `getActiveQuotation` used to do one `priceEntry.findUnique`
  per item inside `Promise.all` — 4 items = 4 extra queries every 3s. Now one batched
  `priceEntry.findMany` via the new private `enrichItems()`. Note `QuotationItem.priceEntryId` is a
  **plain String FK, not a Prisma relation**, so `include: { priceEntry: true }` is not available —
  don't "simplify" it back to an include.
- **Duplicate shop read avoided in the new path.** `getSnapshot` reads the shop row once and derives
  both the promo text and `activeDisplayQuotationId` from it. (Note: the legacy `getState` still does
  the old double read — `getActiveQuotation` reads the shop row, then `getState` reads it again for
  promo text. That was left untouched, not fixed.)
- **`imagesCache` Map**, invalidated in `uploadImage` and `deleteImage`. Without this, folding
  images into the 3s poll would have made DB load *worse* (2 queries/3s vs ~1.4 before).
- **`dotYear: true`** added to both quotation product selects — see "Bug fixed in passing" below.

### `apps/api/src/display/display.controller.ts`
- Added `GET :shopId/snapshot` and `GET :shopId/:staffId/snapshot`. Unguarded, matching the
  sibling GET routes.
- **Old `state` / `search-results` / `images` endpoints intentionally left in place.** Display
  browsers run fullscreen for days; an old tab keeps polling the old URLs until someone reloads it.
  Delete them only after every display screen has been reloaded onto the new bundle.

### `apps/web/src/pages/display/CustomerDisplayPage.tsx`
- Three polling `useEffect`s → **one** at 3s hitting `snapshotUrl`.
- The `shopInfo` fetch (once on mount) and the local carousel `setInterval` are unchanged.
- **Do not change the carousel effects' deps from `images.length` to `images`.** The snapshot
  replaces the images array every 3s; keying on `.length` is what stops the slideshow resetting to
  slide 1 every 3 seconds. This is the single most likely way to break this screen.

### `apps/web/src/pages/pos/PosSearchPage.tsx`
- `const entries = data ?? []` minted a new array identity every render, and `entries` is in the
  dep array of the display-push effect — so it POSTed `search-results` once per keystroke while the
  search was under 3 chars. Now wrapped in `useMemo`.

### Bug fixed in passing
`dotYear` was missing from the API's product `select`, so the **DOT badge never rendered on the
customer display** even though the page has always had markup for it and the staff `QuotationPage`
shows it. Four TypeScript errors were being masked by the fact that `nx build web` (vite) doesn't
typecheck. Now fixed and type-enforced.

---

## Verification status

### Done
| Check | Result |
|---|---|
| `npx nx build api` | passes |
| `npx nx build web` | passes |
| `npx tsc -p apps/api/tsconfig.app.json --noEmit` | 19 errors before → 19 after (no new; all pre-existing tsconfig strictness in untouched files) |
| `npx tsc -p apps/web/tsconfig.app.json --noEmit` | **7 → 3**; the 4 that went away are the `dotYear` errors |
| `/snapshot` returns 200 with all 6 keys | confirmed live |
| Poll cadence | measured 7 requests / 18.7s to **one** distinct URL; zero to `state`/`search-results`/`images` |

The 3 remaining web typecheck errors (`qc` unused in PosSearchPage:25, `data` implicit any in
ProductsImportPage:81, `qPending` unused in SalesReportPage:114) are pre-existing and in code this
change never touched.

### Done — session 2 (2026-07-27), against the real `shop-1` data

> **The local dev API and web server point at the live production Supabase DB.** Everything below
> was done read-only. No rows were written.

| Test | Result |
|---|---|
| **1. Request rate** | **PASS.** 38 requests over a 66s window, **all** to `/snapshot`, inter-request gaps a clean 3000ms (±11ms). **Zero** to `/state`, `/search-results`, `/images`. The one 1ms gap at the start is the StrictMode double-invoke the note below predicted. |
| **2. Idle carousel** | **PASS, decisively.** Tracked the centred slide from its inline `translateX(0vw)` for 65s: 19 transitions, `0→1→2→3→4→0` continuously, every one at 3500ms (±8ms). Never reset to slide 1 — while 22 snapshot responses replaced the images array underneath it. This is the exact regression the doc warns about, and it is absent. |
| **4. Quotation money path** | **PASS, stronger than the on-screen test.** Ran the old per-item loop and the new batched `enrichItems()` side by side over **all 1,679 real quotations** (68 of them with 4+ items): **12,545 field comparisons, 0 mismatches.** |
| **Legacy route** | **PASS.** `/display/shop-1/snapshot` and the per-staff route both return all 6 keys, 5 images, both promo texts, `mode: slideshow`. |
| **8. Query count** | **PASS, but the predicted number was wrong — see below.** |
| `imagesCache` soundness | **PASS by inspection.** `displayImage` has exactly two write sites in the whole API (`display.service.ts:147,168`); both invalidate. No other code path can make the cache stale. |

**Test 8 detail.** Measured by wrapping `pool.query` and replaying `getSnapshot` verbatim:

| Mode | Queries per poll |
|---|---|
| Slideshow (the overwhelmingly common case) | **1** — just the shop row; images come from `imagesCache` |
| Quotation, 1 item | **6** |
| Quotation, 6 items | **6** |

The doc predicted 3. The real floor is **6**, because Prisma expands the `include` into one SELECT
per relation (Quotation → QuotationItem → Customer → Product) before `enrichItems` adds its single
batched PriceEntry query. That is Prisma relation loading, not the N+1 that was fixed.

The number that matters is that it is **constant in item count** — 1 item and 6 items both cost 6.
The old code was ~5+N, so a 6-item quotation cost ~11. And in slideshow mode, which is what the
screen shows almost all day, a poll is now a single query.

`enrichItems()` deduping via `new Set` is safe: no quotation in the DB has two items sharing a
`priceEntryId`, and even if one did, both implementations resolve by id from the same map.

### Done — manual verification (2026-07-27, by the shop owner)

The four auth-gated tests were run by hand and **all passed**:

| Test | Result |
|---|---|
| **3. Search overlay** | **PASS.** Ticking and unticking rows both propagate to the display within the expected ~3s. |
| **5. Dismiss** | **PASS.** "show on display" and the ✕ ปิด button both behave; the overlay does not reappear on the next poll. Navigating away from the tab also clears the quotation automatically (the unmount cleanup effect). |
| **6. Images cache invalidation** | **PASS.** Uploaded and deleted banners propagate — `imagesCache` is invalidating correctly on both write paths. |
| **7. `PosSearchPage` keystroke fix** | **PASS.** A 2-character search produces **zero** POSTs to `search-results`. The `useMemo` is holding. |

**All 8 tests in this document now pass.** No defects were found in the change.

### Note for anyone re-running these

Correcting an assumption in the original plan: pushing a quotation or search results to the display
is **not** a DB write — `setStaffQuotation` / `setStaffSearchResults` only touch in-memory Maps, and
those Maps live in whichever API instance you hit. Driving a *local* API therefore cannot affect the
shop's deployed display screens. Only test 6 genuinely writes.

> ### ⚠️ Do not run tests 3 and 7 against `shop-1`
> `PosSearchPage` fires `POST /quotations/cleanup-stale` on **every mount**
> (`PosSearchPage.tsx:74`), and `cleanupStaleDrafts` cancels **every DRAFT in the shop older than
> 5 minutes** (`quotations.service.ts:157-175`) — not just your own. Each page load during shop
> hours can therefore destroy another staff member's in-progress quote. Use `shop-2` for these.
>
> This is worth fixing on its own: the cleanup is shop-wide and mount-triggered, so a single
> staff member refreshing the POS page cancels colleagues' active drafts.

**Use `shop-2` (Richer Tire) for these, not `shop-1`.** It has 718 price entries and 339 products
with a `dotYear`, so a realistic 4+ item quotation with a DOT badge is buildable — but 0 quotations
and 0 banner images, so there is no live display to disturb. `shop-1` is the running business.

Useful ids: `shop-1` staff1 = `cmpfjgnr800015ocxvs7ysgir`. `shop-2` staff2 = `cmpfjgo5e00025ocxntn197c7`.

> Do **not** run `prisma/seed.ts` to get a test dataset — it upserts against production and would
> create `owner`/`staff1`/`staff2` accounts with repo-visible passwords in the live system.

---

## How to actually test

### Setup
```bash
npx nx serve api
```
```bash
npx nx serve web
```
API on :3000, web on :4200 (vite proxies `/api` → :3000).

Get a real `shopId` and `staffId`:
```bash
npx prisma studio
```
Or seed a known-good dataset — `prisma/seed.ts` creates two shops and users `owner`,
`staff1` (shop 1), `staff2` (shop 2). Passwords are in that file.

You need **two browser windows side by side**:
- **A — staff:** `http://localhost:4200`, logged in as `staff1`
- **B — customer display:** `http://localhost:4200/display/<shop1Id>/<staff1UserId>`

`staff1UserId` is the `User.id` — the same value the staff page uses when it pushes to the display.
Get it from Prisma Studio. Getting this wrong is the most common reason "nothing shows up".

### The tests

**1. Request rate (the actual goal)**
On window B, DevTools → Network, filter `display`. Expect **exactly one** request per 3s, to
`/snapshot`. Zero to `/state`, `/search-results`, `/images`.
> Note: React `StrictMode` is on in dev, so you may see effects double-invoke on mount. Judge the
> steady-state rate after the first few seconds, not the first tick.

**2. Idle carousel — the regression most likely to bite**
Upload 3+ banner images for the shop in settings. With B idle, watch the carousel for ~60s.
- ✅ rotates smoothly every 3.5s and keeps advancing 1→2→3→1
- ❌ **jumps back to slide 1 every 3 seconds** — that means the images array identity is resetting
  the carousel. Check the deps on the two carousel effects are still `images.length`, not `images`.

**3. Search overlay**
On A: `/pos/search`, search a tyre size, tick 2–3 rows, turn the display toggle on.
- B shows the dark comparison table within ~3s, prices matching A
- Untick everything → overlay disappears within ~3s
- Navigate away from `/pos/search` → overlay clears

**4. Quotation overlay**
On A: build a quotation with **4+ items**, hit "show on display".
- B shows the white quote overlay within ~3s
- Every price, discount and total matches A exactly — **this is the highest-risk area**, because
  `enrichItems()` rewrote how `priceListed` / `discTradeIn` / `discCard` / `discCash` / `discPromo`
  are fetched. A silent mismatch here shows wrong prices to a customer.
- **DOT badge now renders** on items that have a `dotYear` (it never did before this change)
- Michelin / BF Goodrich promo text appears if set on the shop

**5. Dismiss**
Click "✕ ปิด" on B. Overlay clears and **does not reappear on the next poll**.
Then repeat on A: convert the quotation to a sale → B falls back to slideshow on its own.

**6. Images cache invalidation**
With B open and idle, upload a new banner image on A.
- It appears on B within ~3s. If it never appears, `imagesCache` isn't being invalidated on upload.
- Same test for deleting an image.

**7. PosSearchPage keystroke fix**
On A at `/pos/search`, DevTools → Network. Type a 2-character search.
- ✅ **no** POST to `search-results`
- ❌ one POST per keystroke means the `useMemo` isn't holding

**8. Query count (optional but worth it)**
Enable Prisma query logging in `PrismaService`. With a 4-item quotation on display, one poll should
issue **3** queries (shop, quotation, batched priceEntry), not 6.

### Legacy route smoke test
The non-staff shape is still live and used when a display is opened without a staffId:
`http://localhost:4200/display/<shopId>` — should behave identically, driven by
`shop.activeDisplayQuotationId` rather than the per-staff cache.

---

## Risks / things to watch

- **`imagesCache` assumes a single API instance.** The service already assumed this for
  `staffQuotationCache` / `searchCache`, so this adds no new constraint — but if the API is ever
  scaled to multiple Railway replicas, all of this in-memory state breaks, not just the new cache.
- **Old display tabs keep polling old endpoints.** After deploying, every customer display in the
  shop must be reloaded before the request-volume drop actually materialises.
- **`enrichItems()` is on the money path.** It feeds the prices a customer reads before agreeing to
  buy. Test 4 is not optional.

## Found while testing — pre-existing, not caused by this change

**179 quotation items reference `priceEntry` rows that no longer exist** (deleted by price-list
re-imports), across 118 quotations. `enrichItems` falls back to `?? 0`, so those items render as
**฿0**. Both the old and new code do this identically — it is not a regression — but 3 of the
affected quotations are still in `SENT` status, so they *can* still be put on a customer display and
would show ฿0 prices. Worth tracking separately: either block deletion of a `priceEntry` still
referenced by a quotation item, or snapshot the prices onto `QuotationItem` at creation time.

## Deliberately out of scope

Agreed during planning, tracked separately:
- **Display GET endpoints have no auth.** Anyone who knows a `shopId` can poll them, and
  `DELETE .../dismiss` can clear any shop's display. The right fix is a shop-scoped display token,
  not `JwtAuthGuard` — the screens are legitimately unauthenticated.
- **`ThrottlerModule` is registered in `app.module.ts` but never wired as an `APP_GUARD`**, so it
  only applies to the login route. Its current config (`ttl 60000 / limit 5`) is far too strict to
  make global without per-route overrides.

## Possible follow-up

If request volume matters more later, **SSE** (`@Sse` in Nest, `EventSource` in the page) replaces
polling entirely: ~10 requests/day/screen instead of 12,000, and the display updates instantly
instead of up to 3s late. The display state already lives in in-memory Maps, so pushing on write is
straightforward. Not urgent below ~20 shops.
