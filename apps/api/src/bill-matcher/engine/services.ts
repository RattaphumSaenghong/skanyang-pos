import { MatchLine, ServiceFeeInput } from './types';

/**
 * Closing the gap between a bill's amount and the goods on it.
 *
 * The shop's fees are quoted as ranges — ปะยาง is "100 to 200 depending on the
 * damage" — and that slack is the whole trick. A fixed-price catalogue can only
 * land on sums it can hit exactly; a set of ranges covers the entire interval
 * [Σmin, Σmax], so almost any gap can be absorbed by real service lines instead
 * of a bare "ค่าบริการ" that fools nobody.
 */

/** Bill amounts in the source sheet are all multiples of 10; fees should look the same. */
export const PRICE_STEP = 10;

export interface FeeEntry {
  fee: ServiceFeeInput;
  qty: number;
  min: number;
  max: number;
}

export interface Lineup {
  entries: FeeEntry[];
  min: number;
  max: number;
}

/** What the bill already contains, which decides *which* fees make sense on it. */
export interface BillContext {
  hasItem: boolean;
  category: string;
  /** Units of the primary item. */
  qty: number;
  isTire: boolean;
}

const TIRE_HINTS = ['ยางนอก', 'ยางใน'];
const BRAKE_HINTS = ['เบรค', 'เบรก'];
const WHEEL_HINTS = ['ล้อ', 'ยาง', 'กะทะ'];

export function isTireCategory(category: string): boolean {
  return TIRE_HINTS.some((h) => category.includes(h));
}

/**
 * Whether a fee belongs on this bill at all, and at what quantity.
 * Returns 0 when the fee has no business being there.
 *
 * These rules exist because arithmetic alone produces nonsense: the first cut
 * of this engine cheerfully invoiced "4 new tyres + patch 4 tyres", which
 * balances perfectly and could never have happened.
 */
export function allowedQty(fee: ServiceFeeInput, ctx: BillContext): number {
  if (!ctx.hasItem) return fee.maxQty; // pure service bill — anything goes

  switch (fee.group) {
    case 'patch':
      // You don't patch a tyre you just bought. But buying two and patching
      // one of the old ones is an ordinary afternoon.
      if (!ctx.isTire) return fee.maxQty;
      return Math.max(0, Math.min(fee.maxQty, 4 - ctx.qty));

    case 'brake':
      // Discs get skimmed while the wheels are already off, so a tyre bill is
      // a natural home for this — but only as many discs as wheels removed.
      if (ctx.isTire) return Math.min(fee.maxQty, ctx.qty);
      return BRAKE_HINTS.some((h) => ctx.category.includes(h)) ? fee.maxQty : 0;

    case 'wheel':
      // Alignment/balancing only makes sense if wheels were involved.
      return WHEEL_HINTS.some((h) => ctx.category.includes(h)) ? fee.maxQty : 0;

    default:
      return fee.maxQty;
  }
}

/** Every admissible combination of fees, cheapest and simplest first. */
export function buildLineups(
  fees: ServiceFeeInput[],
  ctx: BillContext,
  maxLines = 2,
): Lineup[] {
  const singles: Lineup[] = [];
  for (const fee of fees) {
    const cap = allowedQty(fee, ctx);
    for (let qty = 1; qty <= cap; qty++) {
      const entry: FeeEntry = {
        fee,
        qty,
        min: fee.minPrice * qty,
        max: fee.maxPrice * qty,
      };
      singles.push({ entries: [entry], min: entry.min, max: entry.max });
    }
  }

  const all: Lineup[] = [...singles];
  if (maxLines >= 2) {
    for (let i = 0; i < singles.length; i++) {
      for (let j = i + 1; j < singles.length; j++) {
        const a = singles[i].entries[0];
        const b = singles[j].entries[0];
        // One fee per group: a bill never shows both ตั้งศูนย์ and
        // สลับยางถ่วงล้อ + ตั้งศูนย์, and never the same fee twice.
        if (a.fee.group === b.fee.group) continue;
        all.push({
          entries: [a, b],
          min: singles[i].min + singles[j].min,
          max: singles[i].max + singles[j].max,
        });
      }
    }
  }

  // Fewer lines first, then cheaper — so the simplest bill that works wins.
  all.sort((x, y) => x.entries.length - y.entries.length || x.min - y.min);
  return all;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/**
 * A line printed as "เจียจานเบรก ×2  @250  500" has to actually multiply out,
 * so a line's total must stay divisible by its quantity.
 */
function stepFor(e: FeeEntry): number {
  return e.qty > 1 ? (PRICE_STEP * e.qty) / gcd(PRICE_STEP, e.qty) : PRICE_STEP;
}

/**
 * Split `gap` across a line-up, each line landing inside its own range.
 * Every line but the last is snapped to a round figure; the last takes the
 * remainder exactly, which is what makes the bill balance to the baht.
 *
 * Returns null when this line-up simply can't express the gap — the caller
 * moves on to the next one.
 */
export function distribute(lineup: Lineup, gap: number): number[] | null {
  const { entries } = lineup;
  const values: number[] = [];
  let rem = gap;

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const isLast = i === entries.length - 1;
    const rest = entries.slice(i + 1);
    const restMin = rest.reduce((s, r) => s + r.min, 0);
    const restMax = rest.reduce((s, r) => s + r.max, 0);

    const lo = Math.max(e.min, rem - restMax);
    const hi = Math.min(e.max, rem - restMin);
    if (lo > hi) return null;

    let v: number;
    if (isLast) {
      v = rem; // must absorb exactly what's left
      if (v < e.min || v > e.max) return null;
    } else {
      const step = stepFor(e);
      v = Math.ceil(lo / step) * step;
      if (v > hi) return null;
    }
    if (v % e.qty !== 0) return null; // wouldn't print correctly
    values.push(v);
    rem -= v;
  }

  return rem === 0 ? values : null;
}

/**
 * O(1) "can this gap be closed?" lookup.
 *
 * Candidate generation asks this roughly a million times per batch, so the
 * answer for every reachable gap is precomputed once per bill context rather
 * than re-derived per query.
 */
export class GapCloser {
  private readonly lineups: Lineup[];
  private readonly hit: Int16Array; // gap -> lineup index, -1 when unreachable
  readonly maxGap: number;

  constructor(fees: ServiceFeeInput[], ctx: BillContext, maxLines = 2) {
    this.lineups = buildLineups(fees, ctx, maxLines);
    this.maxGap = this.lineups.reduce((m, l) => Math.max(m, l.max), 0);
    this.hit = new Int16Array(this.maxGap + 1).fill(-1);

    for (let li = 0; li < this.lineups.length; li++) {
      const l = this.lineups[li];
      for (let g = l.min; g <= l.max; g++) {
        if (this.hit[g] === -1 && distribute(l, g)) this.hit[g] = li;
      }
    }
  }

  covers(gap: number): boolean {
    if (gap === 0) return true;
    return gap >= 0 && gap <= this.maxGap && this.hit[gap] !== -1;
  }

  /** Materialize the actual service lines. Only called for chosen candidates. */
  lines(gap: number): MatchLine[] | null {
    if (gap === 0) return [];
    if (!this.covers(gap)) return null;
    const lineup = this.lineups[this.hit[gap]];
    const values = distribute(lineup, gap);
    if (!values) return null;

    return lineup.entries.map((e, i) => ({
      kind: 'SERVICE' as const,
      serviceFeeId: e.fee.id,
      description: e.fee.name,
      qty: e.qty,
      unitPrice: values[i] / e.qty, // exact: distribute() enforces divisibility
      lineTotal: values[i],
    }));
  }
}

/** Contexts collapse to a handful of distinct shapes, so closers are cached. */
export function contextKey(ctx: BillContext): string {
  if (!ctx.hasItem) return 'none';
  const cls = ctx.isTire
    ? 'tire'
    : BRAKE_HINTS.some((h) => ctx.category.includes(h))
      ? 'brake'
      : WHEEL_HINTS.some((h) => ctx.category.includes(h))
        ? 'wheel'
        : 'other';
  return `${cls}:${ctx.qty}`;
}
