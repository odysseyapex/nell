import { describe, expect, it } from 'vitest';

import {
  computeCalibration,
  computeClientMetrics,
  computeTrend,
  followThroughOf,
  formatRate,
  tallyReasons,
} from '@/lib/metrics';
import { addDays, isWeekend, isoWeekday, lastNDays, previousNDays, timeBucket } from '@/lib/metrics/dates';
import { fact, series } from './factories';

describe('date helpers', () => {
  it('treats ISO dates as calendar days without timezone drift', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('uses ISO weekdays matching Postgres isodow', () => {
    expect(isoWeekday('2026-08-24')).toBe(1); // Monday
    expect(isoWeekday('2026-08-30')).toBe(7); // Sunday
    expect(isWeekend('2026-08-29')).toBe(true); // Saturday
    expect(isWeekend('2026-08-28')).toBe(false); // Friday
  });

  it('builds adjacent, non-overlapping comparison windows', () => {
    const current = lastNDays('2026-08-30', 30);
    const previous = previousNDays('2026-08-30', 30);
    expect(current).toEqual({ start: '2026-08-01', end: '2026-08-30' });
    expect(previous).toEqual({ start: '2026-07-02', end: '2026-07-31' });
    expect(addDays(previous.end, 1)).toBe(current.start);
  });

  it('buckets hours into parts of the day', () => {
    expect(timeBucket(7)).toBe('morning');
    expect(timeBucket(13)).toBe('afternoon');
    expect(timeBucket(19)).toBe('evening');
    expect(timeBucket(22)).toBe('late_night');
    expect(timeBucket(2)).toBe('late_night');
  });
});

describe('followThroughOf', () => {
  it('counts completed over resolved commitments', () => {
    const facts = [
      fact({ date: '2026-08-01', outcome: 'completed' }),
      fact({ date: '2026-08-02', outcome: 'missed' }),
      fact({ date: '2026-08-03', outcome: 'changed_impulsively' }),
      fact({ date: '2026-08-04', outcome: 'completed' }),
    ];
    const result = followThroughOf(facts);
    expect(result).toMatchObject({ completed: 2, changed: 1, missed: 1, eligible: 4 });
    expect(result.rate).toBe(0.5);
  });

  it('excludes open commitments so an unfinished plan is never counted as a failure', () => {
    const facts = [
      fact({ date: '2026-08-01', outcome: 'completed' }),
      fact({ date: '2026-08-02', outcome: null }), // still planned
      fact({ date: '2026-08-03', outcome: null }),
    ];
    const result = followThroughOf(facts);
    expect(result.eligible).toBe(1);
    expect(result.rate).toBe(1);
  });

  it('returns null rather than zero when there is nothing to measure', () => {
    expect(followThroughOf([]).rate).toBeNull();
    expect(formatRate(null)).toBe('—');
  });

  it('ignores cancelled commitments', () => {
    const facts = [
      fact({ date: '2026-08-01', outcome: 'completed' }),
      fact({ date: '2026-08-02', outcome: null, status: 'cancelled' }),
    ];
    expect(followThroughOf(facts).eligible).toBe(1);
  });
});

describe('computeCalibration', () => {
  it('compares predicted confidence against the outcome of the same commitments', () => {
    const facts = [
      fact({ date: '2026-08-01', outcome: 'completed', confidence: 90 }),
      fact({ date: '2026-08-02', outcome: 'missed', confidence: 90 }),
      fact({ date: '2026-08-03', outcome: 'missed', confidence: 90 }),
      fact({ date: '2026-08-04', outcome: 'completed', confidence: 90 }),
    ];
    const calibration = computeCalibration(facts);
    expect(calibration.predicted).toBeCloseTo(0.9, 5);
    expect(calibration.actual).toBeCloseTo(0.5, 5);
    expect(calibration.gap).toBeCloseTo(0.4, 5);
    expect(calibration.sampleSize).toBe(4);
  });

  it('skips commitments with no confidence score so both halves describe the same rows', () => {
    const facts = [
      fact({ date: '2026-08-01', outcome: 'completed', confidence: 100 }),
      fact({ date: '2026-08-02', outcome: 'missed', confidence: null }),
    ];
    const calibration = computeCalibration(facts);
    expect(calibration.sampleSize).toBe(1);
    expect(calibration.predicted).toBe(1);
    expect(calibration.actual).toBe(1);
  });

  it('reports nothing when there is no usable data', () => {
    expect(computeCalibration([])).toEqual({
      predicted: null,
      actual: null,
      gap: null,
      sampleSize: 0,
    });
  });
});

describe('computeTrend', () => {
  it('flags a decline beyond the threshold', () => {
    const current = followThroughOf(series('2026-08-01', 10, ['completed', 'missed', 'missed', 'missed']));
    const previous = followThroughOf(series('2026-07-01', 10, ['completed', 'completed', 'completed', 'missed']));
    const trend = computeTrend(current, previous);
    expect(trend.direction).toBe('declining');
    expect(trend.delta).toBeLessThan(0);
  });

  it('refuses to call a trend on thin data', () => {
    const current = followThroughOf([fact({ date: '2026-08-01', outcome: 'missed' })]);
    const previous = followThroughOf([fact({ date: '2026-07-01', outcome: 'completed' })]);
    expect(computeTrend(current, previous).direction).toBe('unknown');
  });

  it('treats small movement as steady', () => {
    const current = followThroughOf(series('2026-08-01', 10, ['completed', 'completed', 'completed', 'missed']));
    const previous = followThroughOf(series('2026-07-01', 10, ['completed', 'completed', 'completed', 'missed']));
    expect(computeTrend(current, previous).direction).toBe('steady');
  });
});

describe('tallyReasons', () => {
  it('ranks reasons across commitments that did not complete', () => {
    const facts = [
      fact({ date: '2026-08-01', outcome: 'missed', reason: { slug: 'stress', name: 'Stress', category: 'emotional' } }),
      fact({ date: '2026-08-02', outcome: 'missed', reason: { slug: 'stress', name: 'Stress', category: 'emotional' } }),
      fact({ date: '2026-08-03', outcome: 'changed_impulsively', reason: { slug: 'time', name: 'Not enough time' } }),
      fact({ date: '2026-08-04', outcome: 'completed' }),
    ];
    const tallies = tallyReasons(facts);
    expect(tallies[0]).toMatchObject({ slug: 'stress', count: 2 });
    expect(tallies[0].share).toBeCloseTo(2 / 3, 5);
    expect(tallies).toHaveLength(2);
  });

  it('returns nothing when every commitment completed', () => {
    expect(tallyReasons([fact({ date: '2026-08-01', outcome: 'completed' })])).toEqual([]);
  });
});

describe('computeClientMetrics', () => {
  const referenceDate = '2026-08-30';

  it('produces the full metric set over the right windows', () => {
    const recent = series('2026-08-01', 30, ['completed', 'missed', 'completed', 'missed']);
    const older = series('2026-07-02', 30, ['completed', 'completed', 'completed', 'missed']);
    const metrics = computeClientMetrics({ facts: [...older, ...recent], referenceDate });

    expect(metrics.followThrough30.eligible).toBe(30);
    expect(metrics.followThroughPrev30.eligible).toBe(30);
    expect(metrics.followThrough30.rate).toBeLessThan(metrics.followThroughPrev30.rate!);
    expect(metrics.trend).toBe('declining');
    expect(metrics.byWeekday).toHaveLength(7);
    expect(metrics.byTimeOfDay).toHaveLength(4);
    expect(metrics.commitmentsCreated30).toBe(30);
    expect(metrics.commitmentCreationRatePerWeek).toBe(7);
  });

  it('counts commitments past their date with no check-in as overdue', () => {
    const facts = [
      fact({ date: '2026-08-20', outcome: null }),
      fact({ date: '2026-08-21', outcome: null }),
      fact({ date: '2026-09-05', outcome: null }), // in the future
    ];
    const metrics = computeClientMetrics({ facts, referenceDate });
    expect(metrics.openCommitments).toBe(3);
    expect(metrics.overdueCheckins).toBe(2);
  });

  it('derives exercise completion from entries in the 30-day window', () => {
    const metrics = computeClientMetrics({
      facts: [],
      referenceDate,
      exerciseEntries: [
        { entry_date: '2026-08-20', status: 'completed' },
        { entry_date: '2026-08-21', status: 'completed' },
        { entry_date: '2026-08-22', status: 'abandoned' },
        { entry_date: '2026-06-01', status: 'abandoned' }, // outside the window
      ],
    });
    expect(metrics.exerciseCompletion30).toBeCloseTo(2 / 3, 5);
  });

  it('measures days since last activity against the reference date', () => {
    const metrics = computeClientMetrics({
      facts: [],
      referenceDate,
      lastActivityAt: '2026-08-23T12:00:00.000Z',
    });
    expect(metrics.daysSinceLastActivity).toBe(7);
  });

  it('stays safe on a client with no history at all', () => {
    const metrics = computeClientMetrics({ facts: [], referenceDate });
    expect(metrics.followThrough7.rate).toBeNull();
    expect(metrics.trend).toBe('unknown');
    expect(metrics.topReasons).toEqual([]);
    expect(metrics.calibration.sampleSize).toBe(0);
  });
});
