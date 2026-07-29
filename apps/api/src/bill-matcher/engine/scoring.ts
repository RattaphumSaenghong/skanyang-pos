/**
 * What "realistic" means, expressed as numbers.
 *
 * Matching bills to stock is wildly underdetermined — with 241 distinct prices
 * in the pool almost any amount can be hit several ways. These weights are the
 * whole reason the matcher picks a believable answer instead of merely a
 * correct one, so they are gathered here to be tuned against real output.
 */
export const WEIGHTS = {
  /** Baseline every candidate starts from. */
  base: 100,

  /** The gap closed entirely by real item and service lines. */
  exactBonus: 30,

  /** Per baht dumped on a generic ค่าบริการ line. */
  freeformPenalty: 0.05,

  /**
   * Tyres leave the shop in fours, sometimes twos, occasionally one. A bill
   * showing three identical tyres is the tell that a machine wrote it.
   */
  tireQtyBonus: { 1: 4, 2: 12, 4: 20 } as Record<number, number>,

  /** Non-tyre goods have no natural pairing, so quantity carries no signal. */
  itemBonus: 6,

  /** Each extra service line makes the bill busier and less plausible. */
  serviceLinePenalty: 5,

  /** A second SKU is legitimate but should lose to a clean single-SKU basket. */
  secondItemPenalty: 14,

  /**
   * Nudges allocation toward sold SKUs with several known units. The primary
   * objective is still to allocate as many known sold units as possible.
   */
  soldDepthBonus: 0.3,
  soldDepthCap: 20,

  /** A bill nothing could be found for. Dwarfs every other term by design. */
  unmatchedPenalty: 500,
};

/** Candidates kept per bill. Enough for the repair loop to have alternatives. */
export const MAX_CANDIDATES_PER_BILL = 60;

/** How many bills the repair loop tears up and re-seats each pass. */
export const LNS_BATCH = 50;

export const DEFAULT_TIME_BUDGET_MS = 3000;
