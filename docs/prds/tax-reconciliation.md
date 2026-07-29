# PRD: Tax Reconciliation (Sold Items ↔ Payments Matching)

## Problem Statement

For tax filing, the owner needs to prove that recorded income matches recorded sales. Today the POS captures `Sale`/`SaleItem` records internally, but the owner's actual bookkeeping for tax purposes comes from two separate Excel sheets they maintain outside the system:

1. **Sold items sheet** — SKU + the price it actually sold for. This price is *post-negotiation* and does not match the official price list, so it can't be reconciled against `PriceEntry`.
2. **Payments sheet** — every payment received (bank/QR/cash), independent of the POS.

Today, matching these two sheets to confirm every sold item is backed by a payment (and every payment is backed by a sale) is a manual, error-prone process done outside the app.

## Solution

A new owner-only "Reconciliation" page where the owner uploads both sheets. The system parses both, automatically matches sold-item rows to payments (a payment may cover several items sold the same day, e.g. a set-of-4 sale), and shows three views: matched groups, unmatched items, and unmatched payments. The owner can manually link anything the automatic match missed. The final reconciled result — matched and unmatched — can be exported as one combined sheet to hand to an accountant.

The feature is stateless: upload, review, export. Nothing is persisted to the database, and it does not touch existing `Sale`/`SaleItem` data — the two sheets are treated as independent, external records.

## User Stories

1. As the owner, I want to upload a "sold items" Excel and a "payments" Excel on one page, so I can start a reconciliation without leaving the app.
2. As the owner, I want the system to tell me clearly if a file is missing a required column (SKU/price/date, or amount/date), so I know to fix my sheet instead of getting a silent bad result.
3. As the owner, I want the system to automatically group sold items from the same day and check if their total matches a payment from that day, so I don't have to manually add up set-of-4 sales.
4. As the owner, I want to see a list of matched groups (which items, summed to which payment, on which date) so I can visually confirm the automatic matching is correct.
5. As the owner, I want to see which sold items had no matching payment, so I can investigate missing income.
6. As the owner, I want to see which payments had no matching sold item, so I can investigate income that isn't accounted for in sales (e.g. other revenue, or a data entry mistake).
7. As the owner, I want to manually select one or more unmatched items and one unmatched payment and link them myself, so I can resolve cases the automatic matcher couldn't (e.g. payment received a day late).
8. As the owner, I want a summary showing total sold value, total payments, how much is matched, and the remaining discrepancy amount, so I get the headline number without reading every row.
9. As the owner, I want to export the final reconciliation (after my manual fixes) as one Excel file, so I can hand it directly to my accountant for tax filing.
10. As the owner, I want this page restricted to OWNER/SHOP_OWNER roles, so staff cannot see shop financial reconciliation data.
11. As the owner, I want re-uploading new files to fully reset the previous result, so I don't accidentally mix two periods' data together.
12. As the owner, if a day has an unusually large number of items (making automatic subset matching impractical), I want those rows surfaced as unmatched rather than the system silently guessing wrong, so I don't file an incorrect number.

## Implementation Decisions

### Scope boundary
- The two sheets are **external inputs only** — not derived from `Sale`/`SaleItem`, and not cross-checked against them in this iteration. This keeps the feature fully decoupled from POS transaction data. (Explicitly called out as a possible future enhancement, not building it now.)
- **No new Prisma models, no schema changes.** Per the stateless decision, nothing about an upload or match result is persisted. Each run is upload → parse → match → (optional manual link) → export, entirely in-memory/in-request.

### Backend — new `reconciliation` module (mirrors the `price-lists` module shape)
- `POST /reconciliation/match` (`@Roles(Role.OWNER)`, satisfied by SHOP_OWNER per existing `RolesGuard` behavior) — multipart upload with two file fields (items sheet + payments sheet), using Nest's multi-field file interceptor (same pattern already used for batch image upload in `display.controller.ts`), same 10MB limit + `.xlsx`/`.xls` extension/mimetype filter as price-list import. Parses both files and returns the match result as JSON. No DB writes.
- `POST /reconciliation/export` — accepts the (possibly manually-adjusted) match result as a JSON body and streams back a generated `.xlsx` combining matched and unmatched rows. No DB reads/writes; this is a pure transform of client-supplied data into a workbook.
- New Excel parsing module `apps/api/src/common/excel/reconciliation-parser.ts`, exporting `parseSoldItemsSheet(buffer)` and `parsePaymentsSheet(buffer)`. Since no real sample file exists yet, header detection must be tolerant: auto-detect the header row (don't assume row 1), and match a set of header aliases per required field (e.g. Thai and English variants for "SKU", "price/amount", "date"). Malformed/unparseable rows are skipped and counted, not fatal to the whole import — same non-aborting philosophy as `price-list-parser.ts`. Required columns:
  - Sold items sheet: SKU (or item description if no SKU column), price sold, date sold.
  - Payments sheet: amount, date received. Method/channel and reference/note columns read if present but not required.
- New matching module `apps/api/src/reconciliation/match-engine.ts` exporting a single pure function, e.g. `matchSoldItemsToPayments(items, payments): ReconciliationResult` — no I/O, no framework dependencies, so it can be unit tested in complete isolation. This is the deep module of the feature: simple typed input/output, but encapsulates the actual matching logic so it can evolve (e.g. smarter grouping later) without touching controllers, parsers, or the frontend.

### Matching algorithm (in `match-engine.ts`)
1. Group sold-item rows by calendar date. Group payment rows by calendar date.
2. For each date, attempt to match that date's items against that date's payments only — **no cross-date proximity window** (confirmed decision: same-day grouping only). A payment on a different date than its items will not auto-match and falls to manual linking.
3. Within a date, find subsets of item rows whose price sum equals a payment amount (small rounding tolerance, e.g. ±1 บาท) via bounded subset-sum search. To avoid combinatorial blowup, cap the item count considered per day (e.g. ~20); if a day exceeds the cap, skip auto-matching for that day entirely and leave all its rows unmatched rather than risk an incorrect match (per user story 12).
4. Output: `matchedGroups[]` (payment + its item rows + sum + date), `unmatchedItems[]`, `unmatchedPayments[]`, plus summary totals (sum of all items, sum of all payments, sum matched, sum unmatched/discrepancy).

### Manual override
- Entirely client-side, no extra backend endpoint needed: the owner selects rows across "unmatched items" and "unmatched payments" tables (multi-select items, single-select payment) and clicks "Link" — the frontend moves those rows from the unmatched lists into `matchedGroups` locally (flagged `manual: true` for visual distinction), before the eventual export call. The export endpoint just serializes whatever result shape it's given.

### Frontend
- New page `apps/web/src/pages/reports/ReconciliationPage.tsx`, lazy-loaded route `reports/reconciliation` registered in `apps/web/src/app/app.tsx` alongside the other protected routes.
- New nav entry added to `ownerItems` in `apps/web/src/components/Layout.tsx`, next to the existing `รายงาน`/sales report entry — owner-only, consistent with existing role gating (`isOwner()`).
- Upload UI: two drag-and-drop file zones side by side (sold items / payments), reusing the existing drop-zone pattern from `ProductsImportPage.tsx` (click-to-browse + drag/drop, one `handleFile` per zone). A "Run Match" button enabled once both files are selected, posting both as one `FormData` to `/reconciliation/match`.
- Results view once match returns:
  - Summary stat cards (total sold value, total payments, matched amount, discrepancy) — same stat-card visual pattern already used in the quotation analytics tab of `SalesReportPage.tsx`.
  - Matched groups table: date, payment amount, item rows rolled up underneath, diff (should be ~0).
  - Unmatched items table and unmatched payments table, each row with a checkbox; a contextual action bar appears when the selection is valid (≥1 item + exactly 1 payment) offering "Link selected".
  - Export button posts the current in-memory result (including manual links) to `/reconciliation/export` and triggers a file download — this is a new pattern for the frontend (no existing client-triggered file download exists yet); simplest approach is `window.location` to a blob URL built from the response, discarded after download since nothing is persisted.
- Re-uploading files clears all prior match/override state (per user story 11) — new match run replaces the page's local state wholesale.

## Testing Decisions

Good tests here check external behavior (given rows in, does the right grouping/matched/unmatched shape come out) — not internal implementation steps of the subset-sum search.

- **`match-engine.ts` (primary focus — pure, easiest to test in isolation, highest logic risk)**: table-driven unit tests covering: exact 1:1 same-day match; multiple items summing to one payment; no match when amount differs beyond tolerance; no match when dates differ; rounding-tolerance edge case (off by the smallest currency unit); a day exceeding the subset-sum cap falls through to fully unmatched rather than guessing.
- **`reconciliation-parser.ts`**: unit tests using small in-memory workbooks (built with the `xlsx` write API, no fixture files needed) covering: header row not on row 1; Thai vs. English header aliases; a required column missing (should error clearly, not crash); a malformed row (bad date/amount) skipped and counted rather than aborting the whole parse — same non-aborting behavior as `price-list-parser.ts`, which is the prior art to follow if it has existing tests.
- Controllers/frontend: no dedicated automated tests planned initially, consistent with the rest of the app's current test coverage on `price-lists`/`reports` (no controller-level tests found there either) — manual verification through the running app is the bar for this PRD, same as prior features.

## Out of Scope

- Persisting reconciliation runs/history (e.g. "March 2026 reconciliation") — each run is upload-and-discard.
- Cross-checking against existing `Sale`/`SaleItem` records — the two sheets are treated as fully external to POS transaction data.
- Any date-proximity window beyond the same calendar date (e.g. matching a payment received the next day) — those cases must go through manual linking.
- A new `Payment` ledger model or any schema change — no payments are tracked in the database as a result of this feature.
- Partial/installment payments (one item's price split across multiple payments, or vice versa beyond the same-day subset-sum case).
- Automated tests for controllers or the React page.

## Further Notes

- **Biggest open risk**: the real column layout of both sheets is unknown — the owner does not have a sample file yet. The parser's header-aliasing needs to be revisited (and likely loosened or corrected) against a real file before this ships. Recommend getting one real example of each sheet before or immediately after initial implementation, and treating the parser as the first thing to validate/iterate on.
- Because a payment can span a set-of-4 tire sale, the subset-sum cap per day is a deliberate simplification to keep matching fast and predictable; if real data regularly exceeds the cap (a shop with very high daily item volume), this will need revisiting rather than silently degrading match quality.
