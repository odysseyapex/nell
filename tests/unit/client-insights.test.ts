import { describe, expect, it } from 'vitest';

import {
  buildClientInsights,
  daysOfHistory,
  headlineInsight,
  stageFor,
} from '@/lib/insights/client';
import { fact, series } from './factories';

const referenceDate = '2026-08-30';

describe('insight stages', () => {
  it('grows with the amount of history, not the number of rows', () => {
    expect(stageFor(1)).toBe('first_days');
    expect(stageFor(3)).toBe('first_days');
    expect(stageFor(4)).toBe('early_patterns');
    expect(stageFor(7)).toBe('early_patterns');
    expect(stageFor(8)).toBe('context');
    expect(stageFor(30)).toBe('context');
    expect(stageFor(31)).toBe('behaviour_model');
  });

  it('measures history from the first recorded commitment', () => {
    const facts = [fact({ date: '2026-08-24' }), fact({ date: '2026-08-30' })];
    expect(daysOfHistory(facts, referenceDate)).toBe(7);
    expect(daysOfHistory([], referenceDate)).toBe(0);
  });
});

describe('the first few days', () => {
  it('counts, and does not pretend to see a pattern', () => {
    const facts = [
      fact({ date: '2026-08-28', outcome: 'completed' }),
      fact({ date: '2026-08-29', outcome: 'missed', reason: { slug: 'stress', name: 'Stress' } }),
      fact({ date: '2026-08-30', outcome: 'completed' }),
    ];
    const result = buildClientInsights(facts, { referenceDate });

    expect(result.stage).toBe('first_days');
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0].type).toBe('summary');
    expect(result.cards[0].title).toContain('2 of 3');
  });

  it('says nothing at all before anything has resolved', () => {
    const facts = [fact({ date: '2026-08-30', outcome: null })];
    expect(buildClientInsights(facts, { referenceDate }).cards).toEqual([]);
  });
});

describe('the first week', () => {
  it('offers at most one early signal, and labels it as provisional', () => {
    const facts = [
      ...series('2026-08-24', 4, ['completed'], { createdHour: 9 }),
      ...series('2026-08-28', 3, ['missed'], { createdHour: 22 }),
    ];
    const result = buildClientInsights(facts, { referenceDate });

    expect(result.stage).toBe('early_patterns');
    const signals = result.cards.filter((card) => card.type !== 'summary');
    expect(signals).toHaveLength(1);
    expect(signals[0].provisional).toBe(true);
    expect(signals[0].summary).toMatch(/early signal/i);
  });

  it('stays quiet when the two sides look the same', () => {
    const facts = [
      ...series('2026-08-24', 4, ['completed', 'missed'], { createdHour: 9 }),
      ...series('2026-08-28', 4, ['completed', 'missed'], { createdHour: 22 }),
    ];
    const signals = buildClientInsights(facts, { referenceDate }).cards.filter((c) => c.type !== 'summary');
    expect(signals).toEqual([]);
  });
});

describe('the first month', () => {
  it('surfaces the recurring factor behind changed plans', () => {
    const facts = [
      ...series('2026-08-05', 10, ['completed'], { createdHour: 9 }),
      ...Array.from({ length: 5 }, (_, i) =>
        fact({
          date: `2026-08-1${i + 5}`,
          outcome: 'missed',
          reason: { slug: 'stress', name: 'Stress', category: 'emotional' },
        }),
      ),
      fact({ date: '2026-08-21', outcome: 'missed', reason: { slug: 'time', name: 'Not enough time' } }),
    ];
    const result = buildClientInsights(facts, { referenceDate });

    expect(result.stage).toBe('context');
    const reason = result.cards.find((card) => card.type === 'reason');
    expect(reason).toBeDefined();
    expect(reason!.title).toContain('Stress');
    // Association, never causation.
    expect(reason!.summary).toMatch(/does not mean .* caused it/i);
    expect(reason!.suggestion).toBeTruthy();
  });

  it('reports the confidence gap using both actual figures', () => {
    const facts = [
      ...series('2026-08-05', 6, ['missed'], { confidence: 90, createdHour: 9 }),
      ...series('2026-08-12', 6, ['completed'], { confidence: 90, createdHour: 9 }),
    ];
    const calibration = buildClientInsights(facts, { referenceDate }).cards.find(
      (card) => card.type === 'calibration',
    );

    expect(calibration).toBeDefined();
    expect(calibration!.title).toContain('90%');
    expect(calibration!.title).toContain('50%');
    // The gap is framed as commitment size, not character.
    expect(calibration!.summary).toMatch(/how big the commitment was/i);
  });
});

describe('after a month', () => {
  it('describes the conditions, and leads with them', () => {
    const facts = [
      // Weekday mornings go well.
      ...series('2026-07-06', 20, ['completed', 'completed', 'completed', 'missed'], { createdHour: 9 }),
      // Late-night decisions do not.
      ...series('2026-07-27', 14, ['missed', 'missed', 'completed'], {
        createdHour: 22,
        reason: { slug: 'stress', name: 'Stress', category: 'emotional' },
      }),
    ];
    const result = buildClientInsights(facts, { referenceDate });

    expect(result.stage).toBe('behaviour_model');
    expect(result.cards[0].key).toBe('behaviour_model');
    expect(result.cards[0].summary).toMatch(/go to plan most reliably when/i);
    // It must not read as a fixed statement about the person.
    expect(result.cards[0].summary).toMatch(/not a rule about you/i);
  });

  it('withholds the model when there are not enough distinct conditions', () => {
    const facts = series('2026-07-06', 40, ['completed', 'missed'], { createdHour: 9 });
    const result = buildClientInsights(facts, { referenceDate });
    expect(result.cards.find((card) => card.key === 'behaviour_model')).toBeUndefined();
  });
});

describe('headlineInsight', () => {
  it('never returns the bare count, which is already on the Today screen', () => {
    const facts = [
      ...series('2026-08-05', 10, ['completed'], { createdHour: 9 }),
      ...series('2026-08-16', 8, ['missed'], { createdHour: 22 }),
    ];
    const headline = headlineInsight(buildClientInsights(facts, { referenceDate }));
    expect(headline).not.toBeNull();
    expect(headline!.type).not.toBe('summary');
  });

  it('returns nothing rather than filler when there is only a count', () => {
    const facts = [fact({ date: '2026-08-29', outcome: 'completed' })];
    expect(headlineInsight(buildClientInsights(facts, { referenceDate }))).toBeNull();
  });
});

describe('every card is evidenced and quotes real counts', () => {
  it('attaches evidence to every non-summary card', () => {
    const facts = [
      ...series('2026-07-06', 25, ['completed', 'completed', 'missed'], { createdHour: 9 }),
      ...series('2026-08-01', 15, ['missed', 'completed'], {
        createdHour: 22,
        reason: { slug: 'stress', name: 'Stress', category: 'emotional' },
      }),
    ];
    const result = buildClientInsights(facts, { referenceDate });

    expect(result.cards.length).toBeGreaterThan(1);
    for (const card of result.cards) {
      expect(card.evidence.length).toBeGreaterThan(0);
      expect(card.key.length).toBeGreaterThan(0);
      // Evidence lines carry counts, so nothing is asserted without a number.
      expect(card.evidence.join(' ')).toMatch(/\d/);
    }
  });

  it('gives every card a stable key across identical runs', () => {
    const facts = series('2026-07-06', 30, ['completed', 'missed'], { createdHour: 9 });
    const first = buildClientInsights(facts, { referenceDate }).cards.map((c) => c.key);
    const second = buildClientInsights(facts, { referenceDate }).cards.map((c) => c.key);
    expect(first).toEqual(second);
    expect(new Set(first).size).toBe(first.length);
  });
});
