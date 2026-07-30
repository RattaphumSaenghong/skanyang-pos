import { MAX_MULTIPLICITY } from './archetypes';
import { Candidate, CandidateBuilder } from './candidates';
import { DEFAULT_TIME_BUDGET_MS, LNS_BATCH, WEIGHTS } from './scoring';
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
 *
 * This is the bulk pass. `suggest.ts` runs the same candidate enumeration for a
 * single bill when the operator wants to choose for themselves.
 */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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

  // With no recorded quantities there is no real ceiling, so each SKU is given
  // the most units any archetype could ask for. Locked bills still hold theirs.
  const unconstrained = opts.unconstrained ?? false;
  const capacity = pool.map((it) =>
    Math.max(
      0,
      (unconstrained ? MAX_MULTIPLICITY : it.soldQty) -
        (reserved.get(it.id) ?? 0),
    ),
  );

  // --- candidates, computed once; availability applied at assign time -------
  const builder = new CandidateBuilder(pool, capacity, fees, {
    plausibilityFirst: unconstrained,
  });
  const candidates: Candidate[][] = open.map((bill) => builder.for(bill.amount));

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
  // Completeness leads only when there are sold quantities to be complete about.
  // Left in place with none, the repair loop would chase a meaningless unit count
  // and load every bill with as many items as it could fit.
  const better = (
    a: { units: number; quality: number },
    b: { units: number; quality: number },
  ): boolean =>
    unconstrained
      ? a.quality > b.quality
      : a.units > b.units || (a.units === b.units && a.quality > b.quality);

  // Biggest bills first — they have the fewest ways to be satisfied.
  const baseOrder = open
    .map((_, i) => i)
    .sort((a, b) => open[b].amount - open[a].amount);

  let best = assign(baseOrder);
  let bestScore = total(best);

  // Greedy strands bills a slightly different order would have satisfied, so
  // keep tearing up the worst ones and re-seating them until time runs out.
  while (Date.now() - started < budget) {
    // Worst first, by whichever measure this run is actually optimising.
    const ranked = [...baseOrder].sort((a, b) =>
      unconstrained
        ? (best[a]?.score ?? -1e9) - (best[b]?.score ?? -1e9)
        : (best[a]?.units ?? -1) - (best[b]?.units ?? -1) ||
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

    const lines: MatchLine[] = builder.materialize(c, bill.amount);
    for (const l of lines) {
      if (l.kind === 'ITEM' && l.poolItemId) {
        matchedByPoolItem[l.poolItemId] =
          (matchedByPoolItem[l.poolItemId] ?? 0) + l.qty;
      }
    }

    const freeform = lines
      .filter((l) => l.kind === 'FREEFORM')
      .reduce((s, l) => s + l.lineTotal, 0);
    const covered = lines.reduce((s, l) => s + l.lineTotal, 0);
    return {
      seq: bill.seq,
      amount: bill.amount,
      matched: covered <= bill.amount,
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
