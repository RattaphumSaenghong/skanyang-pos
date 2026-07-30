/**
 * A bill's amount already tells you what kind of sale it was. ฿350 is somebody
 * getting a puncture fixed; ฿26,600 is a set of four. Committing to that shape
 * up front is what keeps the output believable, and as a side effect it throws
 * away most of the search space before the search starts.
 */
export interface Archetype {
  name: string;
  /** Same-SKU quantities worth trying. Never 3 or 5+ — tyres don't sell that way. */
  multiplicities: number[];
  maxLines: number;
  /** Whether to try pairing a second SKU when one SKU can't reach the amount. */
  allowSecondItem: boolean;
}

const TABLE: Array<{ upTo: number; a: Archetype }> = [
  {
    upTo: 600,
    a: {
      name: 'SERVICE_OR_SMALL_ITEM',
      multiplicities: [1, 2, 4],
      maxLines: 2,
      allowSecondItem: true,
    },
  },
  {
    upTo: 2500,
    a: {
      name: 'SMALL_PARTS',
      multiplicities: [1, 2, 4],
      maxLines: 2,
      allowSecondItem: true,
    },
  },
  {
    upTo: 6000,
    a: {
      name: 'SINGLE',
      multiplicities: [1, 2, 4],
      maxLines: 2,
      allowSecondItem: true,
    },
  },
  {
    upTo: 13000,
    a: {
      name: 'PAIR',
      multiplicities: [2, 1, 4],
      maxLines: 3,
      allowSecondItem: true,
    },
  },
  {
    upTo: 32000,
    a: {
      name: 'SET',
      multiplicities: [4, 2],
      maxLines: 3,
      allowSecondItem: true,
    },
  },
];

const LARGE: Archetype = {
  name: 'MULTI',
  multiplicities: [4, 2],
  maxLines: 4,
  allowSecondItem: true,
};

export function archetypeFor(amount: number): Archetype {
  for (const row of TABLE) if (amount <= row.upTo) return row.a;
  return LARGE;
}

/**
 * The most units of a single SKU any archetype will ever ask for.
 *
 * Stands in as the per-item capacity when a batch has no recorded sold
 * quantities: there is no real ceiling to enforce, and anything above this is
 * indistinguishable from unlimited as far as candidate generation is concerned.
 */
export const MAX_MULTIPLICITY = Math.max(
  ...TABLE.flatMap((row) => row.a.multiplicities),
  ...LARGE.multiplicities,
);
