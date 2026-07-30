import { CandidateBuilder, contextFor } from './candidates';
import { BillContext, GapCloser } from './services';
import { MatchLine, PoolItemInput, ServiceFeeInput } from './types';

/**
 * The matcher as an assistant rather than an oracle.
 *
 * Auto-match commits to one answer per bill. In practice the operator knows
 * things the sheet doesn't — which customer bought what — so what they actually
 * want is the shortlist: "here are the five believable ways this ฿12,400 could
 * have been made up, pick one or build your own". Same candidate enumeration and
 * same scoring as the bulk pass, so a suggestion is never something auto-match
 * would have refused to produce.
 *
 * The ORDER differs, though, and deliberately. Auto-match ranks completeness
 * first because placing every known sold unit is a whole-month objective. Looking
 * at one bill that reads backwards: it buries the clean set-of-four under mixed
 * baskets that happen to shift one more unit. So the shortlist leads with
 * plausibility and reports `units` alongside, leaving the operator to prefer the
 * unit-heavy option when they know it's the right one.
 */

export interface Suggestion {
  score: number;
  /** Known sold units this option would allocate. */
  units: number;
  /** Baht left on a generic ค่าบริการ line. 0 is a clean option. */
  freeform: number;
  lines: MatchLine[];
}

const DEFAULT_LIMIT = 5;

/**
 * Top options for one bill, best first.
 *
 * `capacity[i]` is how many units of `pool[i]` are free for THIS bill — the
 * caller must add back whatever this bill already holds, since applying a
 * suggestion replaces its lines rather than adding to them.
 */
export function suggestForBill(
  amount: number,
  pool: PoolItemInput[],
  capacity: number[],
  fees: ServiceFeeInput[],
  limit: number = DEFAULT_LIMIT,
): Suggestion[] {
  const builder = new CandidateBuilder(pool, capacity, fees);
  const seen = new Set<string>();
  const distinct = [];

  for (const c of builder.for(amount)) {
    // Candidates come in near-duplicates — the same basket closed with service
    // lines and again dumped on a free-form line. Within one basket the units are
    // identical, so the engine's own ordering puts the better variant first and
    // keeping just that one gives genuinely different choices instead of five
    // spellings of the same tyre.
    const key = `${c.itemIdx}:${c.qty}|${c.item2Idx}:${c.qty2}`;
    if (seen.has(key)) continue;
    seen.add(key);
    distinct.push(c);
  }

  return distinct
    .sort((a, b) => b.score - a.score || b.units - a.units)
    .slice(0, limit)
    .map((c) => {
      const lines = builder.materialize(c, amount);
      return {
        score: c.score,
        units: c.units,
        freeform: lines
          .filter((l) => l.kind === 'FREEFORM')
          .reduce((s, l) => s + l.lineTotal, 0),
        lines,
      };
    });
}

/**
 * Which fees make sense on a bill is decided by the goods already on it, so a
 * hand-built draft has to declare its shape the same way a candidate does. The
 * dearest item line is treated as the primary one, matching how the matcher
 * builds its own contexts.
 */
export function contextFromLines(
  lines: MatchLine[],
  poolById: Map<string, PoolItemInput>,
): BillContext {
  let primary: PoolItemInput | null = null;
  let primaryQty = 0;
  let bestTotal = -1;

  for (const l of lines) {
    if (l.kind !== 'ITEM' || !l.poolItemId) continue;
    const item = poolById.get(l.poolItemId);
    if (!item) continue;
    if (l.lineTotal > bestTotal) {
      bestTotal = l.lineTotal;
      primary = item;
      primaryQty = l.qty;
    }
  }

  if (!primary) {
    return { hasItem: false, category: '', qty: 0, isTire: false };
  }
  return contextFor(primary, primaryQty);
}

/**
 * Service lines that close `gap` exactly on a bill shaped like `ctx`.
 * Null when the fee ranges simply can't express it — the caller falls back to a
 * free-form line.
 */
export function closeGap(
  gap: number,
  ctx: BillContext,
  fees: ServiceFeeInput[],
): MatchLine[] | null {
  if (gap <= 0) return null;
  const active = fees.filter((f) => f.maxQty > 0 && f.maxPrice >= f.minPrice);
  return new GapCloser(active, ctx).lines(gap);
}
