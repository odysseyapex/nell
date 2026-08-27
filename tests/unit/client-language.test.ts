import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildClientInsights } from '@/lib/insights/client';
import { CHECKIN_OUTCOMES } from '@/lib/types';
import { fact, series } from './factories';

/**
 * The client app must never feel like surveillance.
 *
 * That principle is easy to state and easy to erode one label at a time, so it
 * is enforced here rather than left to reviewer memory. A client is shown
 * follow-through, not a compliance score; a plan that did not happen
 * "changed" or "didn't happen", it did not "fail"; and there are no streaks to
 * break.
 */

const BANNED = [
  { word: 'compliance', because: 'clients get follow-through, never a compliance score' },
  { word: 'streak', because: 'nothing in the product should be breakable by one bad day' },
  { word: 'failure', because: 'an outcome is information, not a verdict' },
  { word: 'failing', because: 'an outcome is information, not a verdict' },
  { word: 'lazy', because: 'never describe the person' },
  { word: 'excuse', because: 'reasons are data, not excuses' },
  { word: 'cheat', because: 'no moral framing of behaviour' },
  { word: 'should have', because: 'no retrospective blame' },
  { word: 'badge', because: 'no gamification' },
];

function scenarios() {
  const referenceDate = '2026-08-30';
  return [
    { name: 'no history', facts: [] },
    { name: 'first days', facts: [fact({ date: '2026-08-29', outcome: 'missed', reason: { slug: 'stress', name: 'Stress' } })] },
    {
      name: 'first week',
      facts: [
        ...series('2026-08-24', 4, ['completed'], { createdHour: 9 }),
        ...series('2026-08-28', 3, ['missed'], { createdHour: 22 }),
      ],
    },
    {
      name: 'a bad month',
      facts: series('2026-08-01', 25, ['missed', 'missed', 'changed_impulsively'], {
        createdHour: 22,
        confidence: 95,
        reason: { slug: 'stress', name: 'Stress', category: 'emotional' },
      }),
    },
    {
      name: 'a good month',
      facts: series('2026-07-06', 40, ['completed', 'completed', 'completed', 'missed'], { createdHour: 9 }),
    },
    {
      name: 'mixed, long history',
      facts: [
        ...series('2026-06-01', 30, ['completed', 'missed'], { createdHour: 9 }),
        ...series('2026-07-15', 30, ['missed', 'completed', 'changed_impulsively'], {
          createdHour: 22,
          reason: { slug: 'stress', name: 'Stress', category: 'emotional' },
        }),
      ],
    },
  ].map((scenario) => ({ ...scenario, referenceDate }));
}

describe('generated client copy', () => {
  it('never uses judgemental or gamified language, in any scenario', () => {
    for (const scenario of scenarios()) {
      const result = buildClientInsights(scenario.facts, { referenceDate: scenario.referenceDate });
      const copy = result.cards
        .flatMap((card) => [card.title, card.summary, card.suggestion ?? '', ...card.evidence])
        .join(' ')
        .toLowerCase();

      for (const { word, because } of BANNED) {
        expect(copy, `"${word}" appeared in the "${scenario.name}" scenario — ${because}`).not.toContain(word);
      }
    }
  });

  it('speaks to the person, not about them, once there is anything to say', () => {
    const result = buildClientInsights(scenarios()[5].facts, { referenceDate: '2026-08-30' });
    const copy = result.cards.map((card) => `${card.title} ${card.summary}`).join(' ').toLowerCase();
    expect(copy).toMatch(/\byou\b|\byour\b/);
    // Third-person framing is how a coach dashboard talks, not a companion.
    expect(copy).not.toMatch(/\bthe client\b|\bthis client\b/);
  });

  it('hedges every provisional card and states nothing flatly on thin data', () => {
    const result = buildClientInsights(scenarios()[2].facts, { referenceDate: '2026-08-30' });
    for (const card of result.cards.filter((c) => c.provisional)) {
      expect(card.summary.toLowerCase()).toMatch(/early signal|small number|only a few/);
    }
  });
});

describe('check-in outcome labels', () => {
  it('describe the event in the first person without grading it', () => {
    const copy = CHECKIN_OUTCOMES.map((o) => `${o.label} ${o.helper}`).join(' ').toLowerCase();
    for (const { word } of BANNED) expect(copy).not.toContain(word);

    // "I didn't do it" is a fact. "Failed" is a verdict.
    expect(CHECKIN_OUTCOMES.map((o) => o.label)).toContain("I didn't do it");
    expect(CHECKIN_OUTCOMES.every((o) => o.label.startsWith('I ') || o.label.startsWith('Circumstances'))).toBe(true);
  });
});

describe('client-facing source files', () => {
  const roots = ['src/app/app/client', 'src/components/client'];

  function collect(dir: string): string[] {
    const out: string[] = [];
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return out;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) out.push(...collect(full));
      else if (/\.tsx?$/.test(entry)) out.push(full);
    }
    return out;
  }

  /**
   * Only what a person actually reads: string literals and JSX text. Import
   * paths and component names are code — `<Badge>` is a UI primitive, not
   * gamification, and flagging it would train us to weaken the guard.
   */
  function visibleCopy(line: string): string {
    if (/^\s*import\b/.test(line)) return '';
    if (line.includes('console.')) return '';

    const parts: string[] = [];
    for (const match of line.matchAll(/(['"`])((?:\\.|(?!\1).)*)\1/g)) parts.push(match[2]);
    for (const match of line.matchAll(/>([^<>{}]+)</g)) parts.push(match[1]);
    return parts.join(' ').toLowerCase();
  }

  it('contain no banned language in user-visible copy', () => {
    const files = roots.flatMap(collect);
    expect(files.length, 'expected client surfaces to exist').toBeGreaterThan(0);

    for (const file of files) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          const copy = visibleCopy(line);
          if (!copy) return;
          for (const { word, because } of BANNED) {
            expect(copy, `${file}:${index + 1} uses "${word}" — ${because}`).not.toContain(word);
          }
        });
    }
  });

  it('the guard actually catches banned copy', () => {
    // A guard that cannot fail is not a guard.
    expect(visibleCopy('        <p>You broke your streak</p>')).toContain('streak');
    expect(visibleCopy('  const label = "compliance score";')).toContain('compliance');
    // …and still ignores code.
    expect(visibleCopy("import { Badge } from '@/components/ui/badge';")).toBe('');
  });
});
