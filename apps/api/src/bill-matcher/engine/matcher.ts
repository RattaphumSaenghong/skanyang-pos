import { archetypeFor } from './archetypes';
import {
  DEFAULT_TIME_BUDGET_MS,
  LNS_BATCH,
  MAX_CANDIDATES_PER_BILL,
  WEIGHTS,
} from './scoring';
import { BillContext, GapCloser, contextKey, isTireCategory } from './services';
import {
  BillInput,
  MatchLine,
  MatchOptions,
  MatchResult,
  MatchedBill,
  PoolItemInput,
  ServiceFeeInput,
} from './types';

/**
 * Attribute stock items — plus service fees as filler — to a month of VAT bills.
 *
 * Bills arrive as bare amounts and the item report supplies known sold
 * quantities in column I. The job is to place as many of those fixed sold units
 * as possible on plausible bills, using service fees to close remainders. It is
 * a multiple-subset-sum problem and so NP-hard; completeness is compared before
 * plausibility so the engine cannot silently prefer a neat-looking bill while
 * leaving a known sold item unallocated.
 *
 * Pure by design: plain objects in, plain objects out, no database, so it can be
 * tested against a real workbook.
 */

/** Compact by intent — the repair loop revisits these tens of thousands of times. */
interface Candidate {
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

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function describe(item: PoolItemInput): string {
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

export function match(
  bills: BillInput[],
  pool: PoolItemInput[],
  fees: ServiceFeeInput[],
  opts: MatchOptions = {},
): MatchResult {
  const started = Date.now();
  const budget = opts.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS;
  const rand = mulberry32(opts.seed ?? 1);

  const activeFees = fees.filter(
    (f) => f.maxQty > 0 && f.maxPrice >= f.minPrice,
  );

  // --- one gap closer per distinct bill shape -------------------------------
  const closers = new Map<string, GapCloser>();
  const closerFor = (ctx: BillContext): GapCloser => {
    const key = contextKey(ctx);
    let c = closers.get(key);
    if (!c) {
      c = new GapCloser(activeFees, ctx);
      closers.set(key, c);
    }
    return c;
  };

  // --- locked bills keep their lines and reserve their stock first ----------
  const reserved = new Map<string, number>();
  const lockedResults: MatchedBill[] = [];
  const open: BillInput[] = [];

  for (const bill of bills) {
    if (bill.locked && bill.existingLines?.length) {
      for (const l of bill.existingLines) {
        if (l.kind === 'ITEM' && l.poolItemId) {
          reserved.set(l.poolItemId, (reserved.get(l.poolItemId) ?? 0) + l.qty);
        }
      }
      const freeform = bill.existingLines
        .filter((l) => l.kind === 'FREEFORM')
        .reduce((s, l) => s + l.lineTotal, 0);
      lockedResults.push({
        seq: bill.seq,
        amount: bill.amount,
        matched: true,
        lines: bill.existingLines,
        freeform,
        score: WEIGHTS.base,
      });
    } else {
      open.push(bill);
    }
  }

  const capacity = pool.map((it) =>
    Math.max(0, it.soldQty - (reserved.get(it.id) ?? 0)),
  );

  // Price index, for the two-SKU fallback's range lookups.
  const byPrice = new Map<number, number[]>();
  pool.forEach((it, i) => {
    const bucket = byPrice.get(it.unitPrice);
    if (bucket) bucket.push(i);
    else byPrice.set(it.unitPrice, [i]);
  });
  const sortedPrices = [...byPrice.keys()].sort((a, b) => a - b);

  /** A second SKU whose multiple lands within service reach of `residual`. */
  function findSecond(
    residual: number,
    maxSvc: number,
  ): { idx: number; qty: number; gap: number } | null {
    for (const q2 of [4, 2, 1]) {
      const hiPrice = Math.floor(residual / q2);
      const loPrice = Math.floor(Math.max(0, residual - maxSvc) / q2);
      if (hiPrice <= 0) continue;

      let lo = 0;
      let hi = sortedPrices.length - 1;
      let start = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (sortedPrices[mid] <= hiPrice) {
          start = mid;
          lo = mid + 1;
        } else hi = mid - 1;
      }
      // Walk down from the dearest: a pricier second item leaves a smaller gap.
      for (let p = start; p >= 0 && sortedPrices[p] >= loPrice; p--) {
        for (const idx of byPrice.get(sortedPrices[p]) as number[]) {
          if (capacity[idx] < q2) continue;
          const g = residual - q2 * sortedPrices[p];
          if (g < 0) continue;
          const ctx2: BillContext = {
            hasItem: true,
            category: pool[idx].category,
            qty: q2,
            isTire: isTireCategory(pool[idx].category),
          };
          if (closerFor(ctx2).covers(g)) return { idx, qty: q2, gap: g };
        }
      }
    }
    return null;
  }

  // --- candidates, computed once; availability applied at assign time -------
  const bareCtx: BillContext = {
    hasItem: false,
    category: '',
    qty: 0,
    isTire: false,
  };
  const bareKey = contextKey(bareCtx);

  const candidates: Candidate[][] = open.map((bill) => {
    const T = bill.amount;
    const arch = archetypeFor(T);
    const out: Candidate[] = [];

    for (let i = 0; i < pool.length; i++) {
      if (capacity[i] <= 0) continue;
      const item = pool[i];
      const tire = isTireCategory(item.category);

      for (const qty of arch.multiplicities) {
        if (qty > capacity[i]) continue;
        const base = qty * item.unitPrice;
        if (base > T) continue;

        const ctx: BillContext = {
          hasItem: true,
          category: item.category,
          qty,
          isTire: tire,
        };
        const key = contextKey(ctx);
        const closer = closerFor(ctx);
        const gap = T - base;

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
          const found = findSecond(gap, closer.maxGap);
          if (found) {
            const k2 = contextKey({
              hasItem: true,
              category: pool[found.idx].category,
              qty: found.qty,
              isTire: isTireCategory(pool[found.idx].category),
            });
            out.push({
              score: scoreOf(item, qty, pool[found.idx], 1, 0),
              units: qty + found.qty,
              itemIdx: i,
              qty,
              item2Idx: found.idx,
              qty2: found.qty,
              gap: found.gap,
              freeform: 0,
              ctxKey: k2,
            });
          }
        }
        // Real goods on the bill, remainder on a bare ค่าบริการ line. Heavily
        // penalised, and only offered when the filler isn't most of the bill.
        if (gap <= T * 0.5) {
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

    const bareCloser = closerFor(bareCtx);
    if (bareCloser.covers(T)) {
      const n = bareCloser.lines(T)?.length ?? 1;
      out.push({
        score: scoreOf(null, 0, null, n, 0),
        units: 0,
        itemIdx: -1,
        qty: 0,
        item2Idx: -1,
        qty2: 0,
        gap: T,
        freeform: 0,
        ctxKey: bareKey,
      });
    }
    // Universal backstop so no bill can end up with nothing at all.
    out.push({
      score: scoreOf(null, 0, null, 0, T),
      units: 0,
      itemIdx: -1,
      qty: 0,
      item2Idx: -1,
      qty2: 0,
      gap: 0,
      freeform: T,
      ctxKey: bareKey,
    });

    // Sold quantities are facts, so allocating more known units outranks every
    // plausibility preference. Quality only decides between equally complete
    // allocations.
    out.sort((a, b) => b.units - a.units || b.score - a.score);
    return out.slice(0, MAX_CANDIDATES_PER_BILL);
  });

  // --- assignment -----------------------------------------------------------
  type Assignment = (Candidate | null)[];

  const assign = (order: number[]): Assignment => {
    const left = capacity.slice();
    const picks: Assignment = new Array(open.length).fill(null);
    for (const bi of order) {
      for (const c of candidates[bi]) {
        if (c.itemIdx >= 0 && left[c.itemIdx] < c.qty) continue;
        if (c.item2Idx >= 0) {
          const need = c.item2Idx === c.itemIdx ? c.qty + c.qty2 : c.qty2;
          if (left[c.item2Idx] < need) continue;
        }
        if (c.itemIdx >= 0) left[c.itemIdx] -= c.qty;
        if (c.item2Idx >= 0) left[c.item2Idx] -= c.qty2;
        picks[bi] = c;
        break;
      }
    }
    return picks;
  };

  const total = (picks: Assignment): { units: number; quality: number } =>
    picks.reduce(
      (s, c) => ({
        units: s.units + (c?.units ?? 0),
        quality: s.quality + (c ? c.score : -WEIGHTS.unmatchedPenalty),
      }),
      { units: 0, quality: 0 },
    );
  const better = (
    a: { units: number; quality: number },
    b: { units: number; quality: number },
  ): boolean =>
    a.units > b.units || (a.units === b.units && a.quality > b.quality);

  // Biggest bills first — they have the fewest ways to be satisfied.
  const baseOrder = open
    .map((_, i) => i)
    .sort((a, b) => open[b].amount - open[a].amount);

  let best = assign(baseOrder);
  let bestScore = total(best);

  // Greedy strands bills a slightly different order would have satisfied, so
  // keep tearing up the worst ones and re-seating them until time runs out.
  while (Date.now() - started < budget) {
    const ranked = [...baseOrder].sort(
      (a, b) =>
        (best[a]?.units ?? -1) - (best[b]?.units ?? -1) ||
        (best[a]?.score ?? -1e9) - (best[b]?.score ?? -1e9),
    );
    const worst = ranked.slice(0, LNS_BATCH);
    for (let i = worst.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [worst[i], worst[j]] = [worst[j], worst[i]];
    }
    const inWorst = new Set(worst);
    const trial = assign([
      ...worst,
      ...baseOrder.filter((b) => !inWorst.has(b)),
    ]);
    const score = total(trial);
    if (better(score, bestScore)) {
      best = trial;
      bestScore = score;
    }
  }

  // --- materialize ----------------------------------------------------------
  const matchedByPoolItem: Record<string, number> = {};
  for (const [id, qty] of reserved) matchedByPoolItem[id] = qty;

  const openResults: MatchedBill[] = open.map((bill, bi) => {
    const c = best[bi];
    if (!c) {
      return {
        seq: bill.seq,
        amount: bill.amount,
        matched: false,
        lines: [],
        freeform: 0,
        score: -WEIGHTS.unmatchedPenalty,
      };
    }

    const lines: MatchLine[] = [];
    const pushItem = (idx: number, qty: number) => {
      const it = pool[idx];
      lines.push({
        kind: 'ITEM',
        poolItemId: it.id,
        description: describe(it),
        qty,
        unitPrice: it.unitPrice,
        lineTotal: qty * it.unitPrice,
      });
      matchedByPoolItem[it.id] = (matchedByPoolItem[it.id] ?? 0) + qty;
    };

    if (c.itemIdx >= 0) pushItem(c.itemIdx, c.qty);
    if (c.item2Idx >= 0) pushItem(c.item2Idx, c.qty2);
    if (c.gap > 0) {
      const svc = closers.get(c.ctxKey)?.lines(c.gap);
      if (svc) lines.push(...svc);
    }

    // Whatever the real lines couldn't cover becomes the free-form line. This
    // is also the safety net if a gap failed to materialize above.
    const shortfall = bill.amount - lines.reduce((s, l) => s + l.lineTotal, 0);
    if (shortfall > 0) {
      lines.push({
        kind: 'FREEFORM',
        description: 'ค่าบริการ',
        qty: 1,
        unitPrice: shortfall,
        lineTotal: shortfall,
      });
    }

    const freeform = lines
      .filter((l) => l.kind === 'FREEFORM')
      .reduce((s, l) => s + l.lineTotal, 0);
    return {
      seq: bill.seq,
      amount: bill.amount,
      matched: shortfall >= 0,
      lines,
      freeform,
      score: c.score,
    };
  });

  const all = [...lockedResults, ...openResults].sort((a, b) => a.seq - b.seq);
  const lineCount = all.reduce((s, b) => s + b.lines.length, 0);
  const knownSoldUnits = pool.reduce((s, item) => s + item.soldQty, 0);
  const matchedSoldUnits = Object.values(matchedByPoolItem).reduce(
    (s, q) => s + q,
    0,
  );

  return {
    bills: all,
    matchedByPoolItem,
    stats: {
      totalBills: all.length,
      matchedBills: all.filter((b) => b.matched).length,
      exactBills: all.filter((b) => b.matched && b.freeform === 0).length,
      totalBillValue: all.reduce((s, b) => s + b.amount, 0),
      freeformTotal: all.reduce((s, b) => s + b.freeform, 0),
      knownSoldUnits,
      matchedSoldUnits,
      unmatchedSoldUnits: Math.max(0, knownSoldUnits - matchedSoldUnits),
      avgLinesPerBill: all.length ? lineCount / all.length : 0,
      elapsedMs: Date.now() - started,
    },
  };
}

export type {
  BillInput,
  PoolItemInput,
  ServiceFeeInput,
  MatchLine,
  MatchedBill,
  MatchOptions,
  MatchResult,
  ParsedBillSheet,
  ParsedItemSheet,
  MatchLineKind,
} from './types';
