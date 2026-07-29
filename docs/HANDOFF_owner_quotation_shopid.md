# Handoff — OWNER-created quotations silently land on the wrong shop

**Status:** root-caused and confirmed against production data. **Not fixed, not deployed.**
**Found:** 2026-07-27, while smoke-testing the display-polling change.
**Severity:** money-impacting. One real sale is currently booked under the wrong shop.

---

## What happens

Logging in as `owner` (the single global `OWNER` / super-admin account, `shopId = null`) and
creating a quotation puts it on **whichever shop's price list Postgres happens to return first**
from an unordered query — not the shop you have selected in the UI.

## Root cause

`CreateQuotationDto` (`apps/api/src/quotations/dto/create-quotation.dto.ts`) does not declare a
`shopId` field. `main.ts` runs the global pipe as `new ValidationPipe({ whitelist: true, transform:
true })`, and `whitelist: true` **silently deletes any body property the DTO doesn't declare** —
it doesn't reject the request, it just drops the field.

The frontend does send it:
```ts
// apps/web/src/pages/pos/PosSearchPage.tsx:87
api.post('/quotations', { items, shopId: effectiveShopId })
```
but it never reaches the controller intact for an OWNER request.

```ts
// apps/api/src/quotations/quotations.controller.ts:20
const shopId = user.role === 'OWNER' ? ((body as any).shopId ?? user.shopId) : user.shopId;
```
`body.shopId` is always `undefined` (stripped). `user.shopId` is `null` for OWNER. So `shopId` is
always `null` here, regardless of what was selected in the UI.

```ts
// apps/api/src/quotations/quotations.service.ts:18-28
async create(dto, userId, shopId) {
  let effectiveShopId = shopId;
  let activePL;
  if (effectiveShopId) {
    activePL = await this.prisma.priceList.findFirst({ where: { shopId: effectiveShopId, isActive: true } });
  } else {
    activePL = await this.prisma.priceList.findFirst({ where: { isActive: true } });  // <- no shop filter, no orderBy
    if (activePL) effectiveShopId = activePL.shopId;
  }
  ...
```
With `shopId` always `null`, this always takes the second branch: "give me any active price list,"
with no `shopId` filter and **no `orderBy`**. Postgres makes no ordering guarantee without one — the
row returned is whatever the query planner happens to pick.

**Blast radius:** OWNER only. Every other role (`SHOP_OWNER`, `STAFF`) is forced onto `user.shopId`
by the same ternary regardless of what's in the body, so there is no cross-shop leakage for normal
accounts — only the one `owner` super-account is affected.

## Why this went unnoticed for two months, and why it broke today

`activePL = priceList.findFirst({ where: { isActive: true } })` (no `shopId`, no `orderBy`) has
always been nondeterministic in principle, but in practice a table scan tends to return rows in a
stable physical order — until something changes that order. Confirmed from production:

```
PriceList cmrmkazd6...  shop=shop-2  imported 2026-07-15 13:58 UTC   <- older row
PriceList cms2nm1ut...  shop=shop-1  imported 2026-07-26 20:15 UTC   <- shop-1 re-imported yesterday evening
```

Every OWNER-created quotation from 2026-05-21 through 2026-07-27 01:17 UTC (**350 of them**) landed
on shop-1 — the "first" row happened to be shop-1's. Shop-1's price list was **re-imported
2026-07-26 20:15 UTC**. The new row physically landed later in storage. From
**2026-07-27 01:32 UTC onward, the "first" row flipped to shop-2**, and every OWNER-created
quotation since has landed on shop-2 (Richer Tire) instead — 6 of them so far, all from tonight's
testing session, confirmed in the DB:

```
cms3e72pu000d01ni4q524vdb  shop-2  CANCELLED  2026-07-27 08:39
cms3e686m000b01ni03e5pvhc  shop-2  CANCELLED  2026-07-27 08:39
cms3d6zc0000701ni07i098m1  shop-2  CONVERTED  2026-07-27 08:11   <- became a real sale, see below
cms3d5vp3000301niozjs2tqo  shop-2  CANCELLED  2026-07-27 08:10
cms3clngp000101ni3ufkx8md  shop-2  CANCELLED  2026-07-27 07:54
cms2yxkb300a5y8cxshru9gj0  shop-2  CANCELLED  2026-07-27 01:32   <- first misroute
```

Any future price-list import — for either shop — can flip which one "wins" again, with no warning.
This is not something that will fix itself or stay fixed; it's luck of insertion order.

## Data that needs reconciling — do this before deploying the code fix

One of the six misrouted quotations was converted to a real sale:

```
Sale #5, id cms3dptys000901niaggvyp34
  shopId       shop-2 (Richer Tire)   <- should be shop-1
  quotationId  cms3d6zc0000701ni07i098m1
  totalAmount  ฿12,600
  createdAt    2026-07-27 08:25:54 UTC
```

That ฿12,600 is currently counted in **Richer Tire's** revenue and absent from **ไทร์พลัส
ส.การยางพิษณุโลก's**. This needs a decision, not just a code fix:

- **Reassign it** — update `Quotation.shopId` and `Sale.shopId` for these two rows to `shop-1`.
  Cleanest if the tire size / customer / items genuinely belong to shop-1 (very likely, given
  `owner` was almost certainly intending to use the shop they always use).
- **Leave it** — if for some reason this really was a Richer Tire transaction.

I have **not** touched this data. It's a financial record; reassigning it needs your sign-off, not
a script I ran unattended. The five `CANCELLED` ones don't need reconciling — they never became
sales — but you may want to know they exist for your own bookkeeping sanity.

Suggested reconciliation SQL, **for you to review and run, not something I've executed**:
```sql
UPDATE "Quotation" SET "shopId" = 'shop-1' WHERE id = 'cms3d6zc0000701ni07i098m1';
UPDATE "Sale"       SET "shopId" = 'shop-1' WHERE id = 'cms3dptys000901niaggvyp34';
```

## The code fix

Small and low-risk. Add the missing field to the DTO so `whitelist` stops stripping it:

```ts
// apps/api/src/quotations/dto/create-quotation.dto.ts
export class CreateQuotationDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateQuotationItemDto)
  items: CreateQuotationItemDto[];

  @IsString()
  @IsOptional()
  shopId?: string;          // <- add this

  @IsString()
  @IsOptional()
  customerId?: string;
  ...
```

Once `body.shopId` reaches the controller intact, the existing controller logic already does the
right thing — no other change needed there. The nondeterministic fallback in
`QuotationsService.create` only fires now if OWNER creates a quotation with **no** shop selected at
all, which is a real edge case worth hardening too:

```ts
// apps/api/src/quotations/quotations.service.ts — optional hardening
activePL = await this.prisma.priceList.findFirst({
  where: { isActive: true },
  orderBy: { importedAt: 'desc' },   // deterministic instead of storage-order luck
});
```
That doesn't make the fallback *correct* (it still guesses a shop), but it stops it from being
silently nondeterministic — same guess every time instead of one that can flip after any import.

## Testing after the fix

1. Log in as `owner`.
2. In the shop selector, pick shop-1 (ไทร์พลัส). Create a quotation. Confirm it lands on `shop-1`
   in the DB (`SELECT "shopId" FROM "Quotation" ORDER BY "createdAt" DESC LIMIT 1`).
3. Switch the selector to shop-2 (Richer Tire). Create another. Confirm it lands on `shop-2`.
4. Re-import a price list for either shop (this is what triggers the failure mode) and repeat
   steps 2–3 — should still route correctly now that `shopId` isn't being silently dropped.

## Out of scope / not done

- Did not touch `create-quotation.dto.ts`, `quotations.service.ts`, or any production data.
- Did not decide the reconciliation for Sale #5 — that's a business call.
- Non-OWNER accounts (`SHOP_OWNER`, `STAFF`) are unaffected and need no changes.
