import { describe, expect, it } from 'vitest';

import {
  detectDecline,
  detectImpulsiveChange,
  detectLatePlanning,
  detectOverconfidence,
  detectPatterns,
  detectReasonDominance,
  detectStrength,
  detectWeekendDip,
  scoreConfidence,
} from '@/lib/patterns/engine';
import type { CommitmentFact } from '@/lib/types';
import { fact, series } from './factories';

/** Builds `count` commitments on consecutive matching weekdays/weekend days. */
function onDays(start: string, count: number, weekend: boolean, outcomes: ('completed' | 'missed')[]) {
  const facts: CommitmentFact[] = [];
  let cursor = Date.parse(`${start}T00:00:00.000Z`);
  let produced = 0;
  while (produced < count) {
    const date = new Date(cursor).toISOString().slice(0, 10);
    const day = new Date(cursor).getUTCDay();
    const isWeekendDay = day === 0 || day === 6;
    if (isWeekendDay === weekend) {
      facts.push(fact({ date, outcome: outcomes[produced % outcomes.length] }));
      produced += 1;
    }
    cursor += 86_400_000;
  }
  return facts;
}

describe('scoreConfidence', () => {
  it('rises with effect size and sample size but never reaches certainty', () => {
    const weak = scoreConfidence(0.1, 0.4, 10, 10);
    const strong = scoreConfidence(0.4, 0.4, 60, 10);
    expect(strong).toBeGreaterThan(weak);
    expect(strong).toBeLessThanOrEqual(0.95);
    expect(weak).toBeGreaterThan(0);
  });
});

describe('detectWeekendDip', () => {
  it('fires when weekend follow-through trails weekdays by more than the threshold', () => {
    const facts = [
      ...onDays('2026-06-01', 20, false, ['completed', 'completed', 'completed', 'missed']), // 75%
      ...onDays('2026-06-06', 10, true, ['missed', 'missed', 'missed', 'completed']), // 25%
    ];
    const pattern = detectWeekendDip(facts);
    expect(pattern).not.toBeNull();
    expect(pattern!.patternType).toBe('weekend_dip');
    expect(pattern!.evidence.data.gap as number).toBeGreaterThanOrEqual(0.2);
    expect(pattern!.evidence.sampleSize).toBe(30);
  });

  it('stays silent below the minimum sample size, however dramatic the gap', () => {
    const facts = [
      ...onDays('2026-06-01', 4, false, ['completed']),
      ...onDays('2026-06-06', 2, true, ['missed']),
    ];
    expect(detectWeekendDip(facts)).toBeNull();
  });

  it('stays silent when weekends are no worse than weekdays', () => {
    const facts = [
      ...onDays('2026-06-01', 20, false, ['completed', 'missed']),
      ...onDays('2026-06-06', 10, true, ['completed', 'missed']),
    ];
    expect(detectWeekendDip(facts)).toBeNull();
  });
});

describe('detectReasonDominance', () => {
  it('fires when one reason accounts for a large share of non-completions', () => {
    const facts = [
      ...Array.from({ length: 5 }, (_, i) =>
        fact({
          date: `2026-08-0${i + 1}`,
          outcome: 'missed',
          reason: { slug: 'stress', name: 'Stress', category: 'emotional' },
        }),
      ),
      fact({ date: '2026-08-06', outcome: 'missed', reason: { slug: 'time', name: 'Not enough time' } }),
      fact({ date: '2026-08-07', outcome: 'missed', reason: { slug: 'forgot', name: 'Forgot' } }),
      fact({ date: '2026-08-08', outcome: 'completed' }),
    ];
    const pattern = detectReasonDominance(facts);
    expect(pattern).not.toBeNull();
    expect(pattern!.patternKey).toBe('reason_dominance:stress');
    expect(pattern!.evidence.data.count).toBe(5);
    // Language must stay associative, never causal.
    expect(pattern!.description).toContain('not a cause');
  });

  it('stays silent when reasons are evenly spread', () => {
    const facts = [
      fact({ date: '2026-08-01', outcome: 'missed', reason: { slug: 'stress' } }),
      fact({ date: '2026-08-02', outcome: 'missed', reason: { slug: 'time' } }),
      fact({ date: '2026-08-03', outcome: 'missed', reason: { slug: 'forgot' } }),
      fact({ date: '2026-08-04', outcome: 'missed', reason: { slug: 'low-energy' } }),
      fact({ date: '2026-08-05', outcome: 'missed', reason: { slug: 'craving' } }),
    ];
    expect(detectReasonDominance(facts)).toBeNull();
  });
});

describe('detectOverconfidence', () => {
  it('fires when predicted confidence is high and outcomes are not', () => {
    const facts = [
      ...series('2026-08-01', 6, ['missed'], { confidence: 90 }),
      ...series('2026-08-07', 4, ['completed'], { confidence: 90 }),
    ];
    const pattern = detectOverconfidence(facts);
    expect(pattern).not.toBeNull();
    expect(pattern!.evidence.data.predicted).toBeCloseTo(0.9, 2);
    expect(pattern!.evidence.data.actual).toBeCloseTo(0.4, 2);
  });

  it('stays silent when confidence and outcomes agree', () => {
    const facts = series('2026-08-01', 12, ['completed'], { confidence: 90 });
    expect(detectOverconfidence(facts)).toBeNull();
  });

  it('stays silent below the minimum sample size', () => {
    const facts = series('2026-08-01', 4, ['missed'], { confidence: 95 });
    expect(detectOverconfidence(facts)).toBeNull();
  });
});

describe('detectLatePlanning', () => {
  it('contrasts the best and worst planning windows', () => {
    const facts = [
      ...series('2026-08-01', 8, ['completed'], { createdHour: 9 }),
      ...series('2026-08-10', 8, ['missed', 'missed', 'missed', 'completed'], { createdHour: 22 }),
    ];
    const pattern = detectLatePlanning(facts);
    expect(pattern).not.toBeNull();
    expect(pattern!.evidence.data.worstBucket).toBe('late_night');
    expect(pattern!.evidence.data.bestBucket).toBe('morning');
  });

  it('ignores commitments with no recorded creation hour', () => {
    const facts = series('2026-08-01', 20, ['missed'], { createdHour: null });
    expect(detectLatePlanning(facts)).toBeNull();
  });
});

describe('detectDecline', () => {
  it('compares the last 30 days with the 30 before it', () => {
    const facts = [
      ...series('2026-07-02', 30, ['completed', 'completed', 'completed', 'missed']),
      ...series('2026-08-01', 30, ['completed', 'missed', 'missed', 'missed']),
    ];
    const pattern = detectDecline(facts, '2026-08-30');
    expect(pattern).not.toBeNull();
    expect(pattern!.evidence.data.delta as number).toBeGreaterThanOrEqual(0.15);
  });

  it('stays silent when there is no prior window to compare against', () => {
    const facts = series('2026-08-01', 30, ['missed']);
    expect(detectDecline(facts, '2026-08-30')).toBeNull();
  });
});

describe('detectImpulsiveChange and detectStrength', () => {
  it('separates impulsive changes from intentional ones', () => {
    const facts = series('2026-08-01', 10, [
      'changed_impulsively',
      'changed_impulsively',
      'changed_intentionally',
      'completed',
    ]);
    const pattern = detectImpulsiveChange(facts);
    expect(pattern).not.toBeNull();
    // 10 commitments cycling through a 4-outcome pattern: indices 0,1,4,5,8,9.
    expect(pattern!.evidence.data.impulsive).toBe(6);
  });

  it('recognises consistent follow-through as a pattern worth naming', () => {
    const facts = series('2026-08-01', 20, ['completed', 'completed', 'completed', 'completed', 'completed', 'missed']);
    const pattern = detectStrength(facts);
    expect(pattern).not.toBeNull();
    expect(pattern!.patternType).toBe('strength');
  });
});

describe('detectPatterns', () => {
  it('returns candidates ordered by confidence and finds several at once', () => {
    const facts = [
      ...onDays('2026-06-01', 24, false, ['completed', 'completed', 'completed', 'missed']),
      ...onDays('2026-06-06', 12, true, ['missed', 'missed', 'missed', 'completed']),
    ];
    const patterns = detectPatterns(facts, { referenceDate: '2026-08-30' });
    expect(patterns.length).toBeGreaterThan(0);
    const confidences = patterns.map((p) => p.confidence);
    expect([...confidences].sort((a, b) => b - a)).toEqual(confidences);
    expect(patterns.every((p) => p.evidence.sampleSize > 0)).toBe(true);
  });

  it('returns nothing for a client with almost no history', () => {
    const patterns = detectPatterns([fact({ date: '2026-08-29', outcome: 'missed' })], {
      referenceDate: '2026-08-30',
    });
    expect(patterns).toEqual([]);
  });

  it('gives every candidate a stable key so re-detection updates rather than duplicates', () => {
    const facts = [
      ...onDays('2026-06-01', 24, false, ['completed', 'completed', 'completed', 'missed']),
      ...onDays('2026-06-06', 12, true, ['missed', 'missed', 'missed', 'completed']),
    ];
    const first = detectPatterns(facts, { referenceDate: '2026-08-30' }).map((p) => p.patternKey);
    const second = detectPatterns(facts, { referenceDate: '2026-08-30' }).map((p) => p.patternKey);
    expect(first).toEqual(second);
    expect(new Set(first).size).toBe(first.length);
  });
});
