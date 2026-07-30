import { archetypeFor } from './archetypes';
import { MAX_CANDIDATES_PER_BILL, WEIGHTS } from './scoring';
import { BillContext, GapCloser, contextKey, isTireCategory } from './services';
import { MatchLine, PoolItemInput, ServiceFeeInput } from './types';

/**
 * Enumerating the plausible ways one bill amount could have been made up.
 *
 * Split out of the matcher because two callers need the exact same notion of
 * "plausible": the batch matcher, which picks one candidate per bill under a
 * global stock constraint, and the per-bill suggester, which shows the operator
 * the top few so they can choose. Sharing this file is what keeps the
 * suggestions the operator sees consistent with what auto-match would do.
 */

/** Compact by intent — the repair loop revisits these tens of thousands of times. */
export interface Candidate {
  score: number;
  /** Known sold units this candidate allocates. Compared before quality score. */
  units: number;
  itemIdx: number; // -1 when the bill carries no goods
  qty: number;
  item2Idx: number; // -1 when a single SKU covered it
  qty2: number;
  gap: number; // to be closed by service lines
  freeform: number; // baht no real line could absorb
  ctxKey: string;
}

export function describe(item: PoolItemInput): string {
  return [item.category, item.brand, item.model, item.size]
    .map((s) => (s ?? '').trim())
    .filter(Boolean)
    .join(' ');
}

function scoreOf(
  item: PoolItemInput | null,
  qty: number,
  item2: PoolItemInput | null,
  serviceLines: number,
  freeform: number,
): number {
  let s = WEIGHTS.base;
  s -= freeform * WEIGHTS.freeformPenalty;
  if (freeform === 0) s += WEIGHTS.exactBonus;

  if (item) {
    s += isTireCategory(item.category)
      ? (WEIGHTS.tireQtyBonus[qty] ?? -30)
      : WEIGHTS.itemBonus;
    s += Math.min(item.soldQty, WEIGHTS.soldDepthCap) * WEIGHTS.soldDepthBonus;
  }
  if (item2) s -= WEIGHTS.secondItemPenalty;
  s -= serviceLines * WEIGHTS.serviceLinePenalty;
  return s;
}

const BARE_CTX: BillContext = {
  hasItem: false,
  category: '',
  qty: 0,
  isTire: false,
};

export function contextFor(item: PoolItemInput, qty: number): BillContext {
  return {
    hasItem: true,
    category: item.category,
    qty,
    isTire: isTireCategory(item.category),
  };
}

export class CandidateBuilder {
  private readonly fees: ServiceFeeInput[];
  private readonly closers = new Map<string, GapCloser>();
  private readonly byPrice = new Map<number, number[]>();
  private readonly sortedPrices: number[];

  /**
   * `capacity[i]` is how many units of `pool[i]` are still free. Treated as
   * read-only — callers that consume stock keep their own copy.
   */
  constructor(
    private readonly pool: PoolItemInput[],
    private readonly capacity: number[],
    fees: ServiceFeeInput[],
  ) {
    this.fees = fees.filter((f) => f.maxQty > 0 && f.maxPrice >= f.minPrice);

    // Price index, for the two-SKU fallback's range lookups.
    pool.forEach((it, i) => {
      const bucket = this.byPrice.get(it.unitPrice);
      if (bucket) bucket.push(i);
      else this.byPrice.set(it.unitPrice, [i]);
    });
    this.sortedPrices = [...this.byPrice.keys()].sort((a, b) => a - b);
  }

  /** One gap closer per distinct bill shape; contexts collapse to a handful. */
  closerFor(ctx: BillContext): GapCloser {
    const key = contextKey(ctx);
    let c = this.closers.get(key);
    if (!c) {
      c = new GapCloser(this.fees, ctx);
      this.closers.set(key, c);
    }
    return c;
  }

  /** A second SKU whose multiple lands within service reach of `residual`. */
  private findSecond(
    residual: number,
    maxSvc: number,
  ): { idx: number; qty: number; gap: number } | null {
    for (const q2 of [4, 2, 1]) {
      const hiPrice = Math.floor(residual / q2);
      const loPrice = Math.floor(Math.max(0, residual - maxSvc) / q2);
      if (hiPrice <= 0) continue;

      let lo = 0;
      let hi = this.sortedPrices.length - 1;
      let start = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (this.sortedPrices[mid] <= hiPrice) {
          start = mid;
          lo = mid + 1;
        } else hi = mid - 1;
      }
      // Walk down from the dearest: a pricier second item leaves a smaller gap.
      for (let p = start; p >= 0 && this.sortedPrices[p] >= loPrice; p--) {
        for (const idx of this.byPrice.get(this.sortedPrices[p]) as number[]) {
          if (this.capacity[idx] < q2) continue;
          const g = residual - q2 * this.sortedPrices[p];
          if (g < 0) continue;
          if (this.closerFor(contextFor(this.pool[idx], q2)).covers(g)) {
            return { idx, qty: q2, gap: g };
          }
        }
      }
    }
    return null;
  }

  /**
   * Every plausible make-up of `amount`, best first. Availability is checked
   * against `capacity` here but re-checked at assign time, because the batch
   * matcher spends stock as it goes.
   */
  for(amount: number): Candidate[] {
    const arch = archetypeFor(amount);
    const out: Candidate[] = [];

    for (let i = 0; i < this.pool.length; i++) {
      if (this.capacity[i] <= 0) continue;
      const item = this.pool[i];

      for (const qty of arch.multiplicities) {
        if (qty > this.capacity[i]) continue;
        const base = qty * item.unitPrice;
        if (base > amount) continue;

        const ctx = contextFor(item, qty);
        const key = contextKey(ctx);
        const closer = this.closerFor(ctx);
        const gap = amount - base;

        if (gap === 0) {
          out.push({
            score: scoreOf(item, qty, null, 0, 0),
            units: qty,
            itemIdx: i,
            qty,
            item2Idx: -1,
            qty2: 0,
            gap: 0,
            freeform: 0,
            ctxKey: key,
          });
          continue;
        }
        if (closer.covers(gap)) {
          const n = closer.lines(gap)?.length ?? 1;
          out.push({
            score: scoreOf(item, qty, null, n, 0),
            units: qty,
            itemIdx: i,
            qty,
            item2Idx: -1,
            qty2: 0,
            gap,
            freeform: 0,
            ctxKey: key,
          });
          continue;
        }
        if (arch.allowSecondItem) {
          const found = this.findSecond(gap, closer.maxGap);
          if (found) {
            out.push({
              score: scoreOf(item, qty, this.pool[found.idx], 1, 0),
              units: qty + found.qty,
              itemIdx: i,
              qty,
              item2Idx: found.idx,
              qty2: found.qty,
              gap: found.gap,
              freeform: 0,
              ctxKey: contextKey(contextFor(this.pool[found.idx], found.qty)),
            });
          }
        }
        // Real goods on the bill, remainder on a bare ค่าบริการ line. Heavily
        // penalised, and only offered when the filler isn't most of the bill.
        if (gap <= amount * 0.5) {
          out.push({
            score: scoreOf(item, qty, null, 0, gap),
            units: qty,
            itemIdx: i,
            qty,
            item2Idx: -1,
            qty2: 0,
            gap: 0,
            freeform: gap,
            ctxKey: key,
          });
        }
      }
    }

    const bareKey = contextKey(BARE_CTX);
    const bareCloser = this.closerFor(BARE_CTX);
    if (bareCloser.covers(amount)) {
      const n = bareCloser.lines(amount)?.length ?? 1;
      out.push({
        score: scoreOf(null, 0, null, n, 0),
        units: 0,
        itemIdx: -1,
        qty: 0,
        item2Idx: -1,
        qty2: 0,
        gap: amount,
        freeform: 0,
        ctxKey: bareKey,
      });
    }
    // Universal backstop so no bill can end up with nothing at all.
    out.push({
      score: scoreOf(null, 0, null, 0, amount),
      units: 0,
      itemIdx: -1,
      qty: 0,
      item2Idx: -1,
      qty2: 0,
      gap: 0,
      freeform: amount,
      ctxKey: bareKey,
    });

    // Sold quantities are facts, so allocating more known units outranks every
    // plausibility preference. Quality only decides between equally complete
    // allocations.
    out.sort((a, b) => b.units - a.units || b.score - a.score);
    return out.slice(0, MAX_CANDIDATES_PER_BILL);
  }

  /** Turn a chosen candidate into the actual bill lines. */
  materialize(c: Candidate, amount: number): MatchLine[] {
    const lines: MatchLine[] = [];
    const pushItem = (idx: number, qty: number) => {
      const it = this.pool[idx];
      lines.push({
        kind: 'ITEM',
        poolItemId: it.id,
        description: describe(it),
        qty,
        unitPrice: it.unitPrice,
        lineTotal: qty * it.unitPrice,
      });
    };

    if (c.itemIdx >= 0) pushItem(c.itemIdx, c.qty);
    if (c.item2Idx >= 0) pushItem(c.item2Idx, c.qty2);
    if (c.gap > 0) {
      const svc = this.closers.get(c.ctxKey)?.lines(c.gap);
      if (svc) lines.push(...svc);
    }

    // Whatever the real lines couldn't cover becomes the free-form line. This
    // is also the safety net if a gap failed to materialize above.
    const shortfall = amount - lines.reduce((s, l) => s + l.lineTotal, 0);
    if (shortfall > 0) {
      lines.push({
        kind: 'FREEFORM',
        description: 'ค่าบริการ',
        qty: 1,
        unitPrice: shortfall,
        lineTotal: shortfall,
      });
    }

    return lines;
  }
}
