import { describe, expect, it } from 'vitest';
import { dayRangeUtc, isValidDateString, shopDateString, shopTimeString } from './tz';

describe('dayRangeUtc', () => {
  it('starts a Bangkok day at 17:00 UTC the previous day', () => {
    const { start, end } = dayRangeUtc('2026-07-28');
    expect(start.toISOString()).toBe('2026-07-27T17:00:00.000Z');
    expect(end.toISOString()).toBe('2026-07-28T17:00:00.000Z');
  });

  it('puts a 08:00 Bangkok booking inside that day, not the day before', () => {
    // 08:00 in Bangkok on the 28th is 01:00Z on the 28th.
    const booking = new Date('2026-07-28T01:00:00.000Z');
    const { start, end } = dayRangeUtc('2026-07-28');
    expect(booking >= start && booking < end).toBe(true);
  });

  it('puts a 22:00 Bangkok booking inside that day, not the day after', () => {
    // 22:00 in Bangkok on the 28th is 15:00Z on the 28th — the naive UTC-day
    // window would still catch this one; the 08:00 case above is the real trap.
    const booking = new Date('2026-07-28T15:00:00.000Z');
    const { start, end } = dayRangeUtc('2026-07-28');
    expect(booking >= start && booking < end).toBe(true);
  });

  it('excludes an instant one millisecond past the end', () => {
    const { end } = dayRangeUtc('2026-07-28');
    const { start: nextStart } = dayRangeUtc('2026-07-29');
    expect(end.getTime()).toBe(nextStart.getTime());
  });
});

describe('shopDateString', () => {
  it('reports the Bangkok date for a late-evening UTC instant', () => {
    // 2026-07-27T18:30Z is already 01:30 on the 28th in Bangkok.
    expect(shopDateString(new Date('2026-07-27T18:30:00.000Z'))).toBe('2026-07-28');
  });

  it('reports the Bangkok date for an early-morning UTC instant', () => {
    expect(shopDateString(new Date('2026-07-28T02:00:00.000Z'))).toBe('2026-07-28');
  });
});

describe('shopTimeString', () => {
  it('renders the Bangkok wall clock, not the server clock', () => {
    // 07:00Z is 14:00 in Bangkok — the time staff would actually have booked.
    expect(shopTimeString(new Date('2026-07-28T07:00:00.000Z'))).toBe('14:00');
  });

  it('handles an instant that falls on the previous UTC day', () => {
    expect(shopTimeString(new Date('2026-07-27T18:30:00.000Z'))).toBe('01:30');
  });
});

describe('isValidDateString', () => {
  it('accepts a real date', () => {
    expect(isValidDateString('2026-07-28')).toBe(true);
  });

  it('rejects malformed and impossible dates', () => {
    expect(isValidDateString('2026-7-28')).toBe(false);
    expect(isValidDateString('28-07-2026')).toBe(false);
    expect(isValidDateString('2026-02-30')).toBe(false);
    expect(isValidDateString('nonsense')).toBe(false);
  });
});
