/**
 * Bay allocation rules.
 *
 * Deliberately pure: no Prisma, no Nest, no clock of its own. Everything is
 * passed in so the whole thing is testable without a database, following the
 * direction set for the match engine in docs/prds/tax-reconciliation.md.
 *
 * Nothing here moves a car. `suggestBay` returns a recommendation that the UI
 * renders as a highlighted button; a person always makes the final call.
 */

/** Structural subsets of the Prisma rows — assignable from the real models. */
export interface AllocBay {
  id: string;
  mode: 'GENERAL' | 'BOOKING_ONLY';
  active: boolean;
  sortOrder: number;
}

export interface AllocJob {
  kind: 'WALK_IN' | 'BOOKING';
  /** Reserved bay while BOOKED, occupied bay while IN_PROGRESS. */
  bayId: string | null;
  estimatedMinutes: number;
  startedAt: Date | null;
}

export interface BaySuggestion {
  bayId: string;
  /** null when the bay is free right now, otherwise when it should free up. */
  freeAt: Date | null;
}

/** When a started job is expected to be done. Null if it has not started. */
export function estimatedFinish(job: AllocJob): Date | null {
  if (!job.startedAt) return null;
  return new Date(job.startedAt.getTime() + job.estimatedMinutes * 60_000);
}

/** Minutes a running job is past its estimate. 0 when on time or not started. */
export function overdueMinutes(job: AllocJob, now: Date): number {
  const finish = estimatedFinish(job);
  if (!finish) return 0;
  const over = now.getTime() - finish.getTime();
  return over > 0 ? Math.floor(over / 60_000) : 0;
}

/** A BOOKING_ONLY bay is reserved for booked cars; inactive bays take nothing. */
export function isEligible(bay: AllocBay, job: AllocJob): boolean {
  if (!bay.active) return false;
  if (bay.mode === 'BOOKING_ONLY' && job.kind !== 'BOOKING') return false;
  return true;
}

/**
 * Recommend a bay for a waiting job.
 *
 * @param bays       every bay in the shop
 * @param occupying  the jobs currently IN_PROGRESS (each with its bayId set)
 * @param job        the waiting job to place
 *
 * In order: the job's own reserved bay if it is free, then the lowest-numbered
 * free bay, then the eligible bay that frees up soonest. Null when the shop has
 * no bay this job could ever go in (e.g. a walk-in when every bay is
 * BOOKING_ONLY) — the caller renders that as "no suggestion", not an error.
 */
export function suggestBay(
  bays: AllocBay[],
  occupying: AllocJob[],
  job: AllocJob,
): BaySuggestion | null {
  const eligible = bays.filter((bay) => isEligible(bay, job));
  if (eligible.length === 0) return null;

  const occupantOf = new Map<string, AllocJob>();
  for (const running of occupying) {
    if (running.bayId) occupantOf.set(running.bayId, running);
  }

  const free = eligible
    .filter((bay) => !occupantOf.has(bay.id))
    .sort((a, b) => a.sortOrder - b.sortOrder);

  // A checked-in booking goes back to the bay it was booked into, when free.
  if (job.bayId && free.some((bay) => bay.id === job.bayId)) {
    return { bayId: job.bayId, freeAt: null };
  }

  if (free.length > 0) return { bayId: free[0].id, freeAt: null };

  // Everything eligible is busy: offer whichever frees up first, so the UI can
  // show an ETA instead of a button. A running job with no startedAt has no
  // computable finish, so it sorts last rather than pretending to be soonest.
  const busy = eligible
    .map((bay) => ({ bay, freeAt: estimatedFinish(occupantOf.get(bay.id)!) }))
    .sort((a, b) => {
      if (a.freeAt && b.freeAt) return a.freeAt.getTime() - b.freeAt.getTime();
      if (a.freeAt) return -1;
      if (b.freeAt) return 1;
      return a.bay.sortOrder - b.bay.sortOrder;
    });

  return { bayId: busy[0].bay.id, freeAt: busy[0].freeAt };
}
