import { describe, expect, it } from 'vitest';
import {
  AllocBay,
  AllocJob,
  estimatedFinish,
  isEligible,
  overdueMinutes,
  suggestBay,
} from './allocation';

const bay = (id: string, sortOrder: number, over: Partial<AllocBay> = {}): AllocBay => ({
  id,
  mode: 'GENERAL',
  active: true,
  sortOrder,
  ...over,
});

const job = (over: Partial<AllocJob> = {}): AllocJob => ({
  kind: 'WALK_IN',
  bayId: null,
  estimatedMinutes: 30,
  startedAt: null,
  ...over,
});

const at = (hhmm: string) => new Date(`2026-07-28T${hhmm}:00.000Z`);

describe('estimatedFinish', () => {
  it('is startedAt plus the estimate', () => {
    expect(estimatedFinish(job({ startedAt: at('10:00'), estimatedMinutes: 45 })))
      .toEqual(at('10:45'));
  });

  it('is null for a job that has not started', () => {
    expect(estimatedFinish(job())).toBeNull();
  });
});

describe('overdueMinutes', () => {
  it('is 0 while the job is still within its estimate', () => {
    const running = job({ startedAt: at('10:00'), estimatedMinutes: 30 });
    expect(overdueMinutes(running, at('10:20'))).toBe(0);
  });

  it('counts whole minutes past the estimate', () => {
    const running = job({ startedAt: at('10:00'), estimatedMinutes: 30 });
    expect(overdueMinutes(running, at('10:42'))).toBe(12);
  });

  it('is 0 for a job that has not started', () => {
    expect(overdueMinutes(job(), at('10:00'))).toBe(0);
  });
});

describe('isEligible', () => {
  it('keeps walk-ins out of a BOOKING_ONLY bay', () => {
    expect(isEligible(bay('b1', 1, { mode: 'BOOKING_ONLY' }), job({ kind: 'WALK_IN' }))).toBe(false);
  });

  it('lets a booking into a BOOKING_ONLY bay', () => {
    expect(isEligible(bay('b1', 1, { mode: 'BOOKING_ONLY' }), job({ kind: 'BOOKING' }))).toBe(true);
  });

  it('lets anything into a GENERAL bay', () => {
    expect(isEligible(bay('b1', 1), job({ kind: 'WALK_IN' }))).toBe(true);
    expect(isEligible(bay('b1', 1), job({ kind: 'BOOKING' }))).toBe(true);
  });

  it('rejects an inactive bay regardless of mode', () => {
    expect(isEligible(bay('b1', 1, { active: false }), job({ kind: 'BOOKING' }))).toBe(false);
  });
});

describe('suggestBay', () => {
  const bays = [bay('b1', 1), bay('b2', 2), bay('b3', 3), bay('b4', 4)];

  it('picks the lowest-numbered free bay', () => {
    expect(suggestBay(bays, [], job())).toEqual({ bayId: 'b1', freeAt: null });
  });

  it('skips bays that are occupied', () => {
    const running = job({ bayId: 'b1', startedAt: at('10:00') });
    expect(suggestBay(bays, [running], job())).toEqual({ bayId: 'b2', freeAt: null });
  });

  it('never suggests an inactive bay', () => {
    const withDeadBay = [bay('b1', 1, { active: false }), bay('b2', 2)];
    expect(suggestBay(withDeadBay, [], job())).toEqual({ bayId: 'b2', freeAt: null });
  });

  it('never suggests a BOOKING_ONLY bay for a walk-in', () => {
    const withBookingLane = [bay('b1', 1, { mode: 'BOOKING_ONLY' }), bay('b2', 2)];
    expect(suggestBay(withBookingLane, [], job({ kind: 'WALK_IN' }))).toEqual({
      bayId: 'b2',
      freeAt: null,
    });
  });

  it('returns null when no bay could ever take the job', () => {
    const allBookingOnly = [bay('b1', 1, { mode: 'BOOKING_ONLY' })];
    expect(suggestBay(allBookingOnly, [], job({ kind: 'WALK_IN' }))).toBeNull();
  });

  it('prefers the bay a booking was reserved into, over a lower-numbered free bay', () => {
    const checkedIn = job({ kind: 'BOOKING', bayId: 'b3' });
    expect(suggestBay(bays, [], checkedIn)).toEqual({ bayId: 'b3', freeAt: null });
  });

  it('falls back to the lowest free bay when the reserved bay is busy', () => {
    const checkedIn = job({ kind: 'BOOKING', bayId: 'b3' });
    const running = job({ bayId: 'b3', startedAt: at('10:00') });
    expect(suggestBay(bays, [running], checkedIn)).toEqual({ bayId: 'b1', freeAt: null });
  });

  it('offers the soonest-free bay with its ETA when everything is busy', () => {
    const occupying = [
      job({ bayId: 'b1', startedAt: at('10:00'), estimatedMinutes: 60 }), // 11:00
      job({ bayId: 'b2', startedAt: at('10:00'), estimatedMinutes: 20 }), // 10:20
      job({ bayId: 'b3', startedAt: at('10:00'), estimatedMinutes: 45 }), // 10:45
      job({ bayId: 'b4', startedAt: at('10:00'), estimatedMinutes: 90 }), // 11:30
    ];
    expect(suggestBay(bays, occupying, job())).toEqual({ bayId: 'b2', freeAt: at('10:20') });
  });

  it('ignores a busy BOOKING_ONLY bay when picking the soonest ETA for a walk-in', () => {
    const lanes = [bay('b1', 1, { mode: 'BOOKING_ONLY' }), bay('b2', 2)];
    const occupying = [
      job({ bayId: 'b1', startedAt: at('10:00'), estimatedMinutes: 10 }), // sooner, but ineligible
      job({ bayId: 'b2', startedAt: at('10:00'), estimatedMinutes: 50 }),
    ];
    expect(suggestBay(lanes, occupying, job({ kind: 'WALK_IN' }))).toEqual({
      bayId: 'b2',
      freeAt: at('10:50'),
    });
  });

  it('reports an ETA in the past for an overdue job rather than hiding it', () => {
    const occupying = [job({ bayId: 'b1', startedAt: at('09:00'), estimatedMinutes: 30 })];
    expect(suggestBay([bay('b1', 1)], occupying, job())).toEqual({
      bayId: 'b1',
      freeAt: at('09:30'),
    });
  });
});
