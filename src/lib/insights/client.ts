/**
 * Client-facing insights.
 *
 * The coach engine answers "who needs me and why?". This one answers "what am
 * I learning about myself?", and that difference is not cosmetic:
 *
 *   - It is addressed to the person, in second person, about conditions rather
 *     than character. Never "you failed", never a compliance score, never a
 *     streak.
 *   - It gets smarter as the record grows. On day two it can only count. By
 *     day thirty it can describe the conditions under which things go well.
 *   - It says when it is guessing. An early signal is labelled as one, with
 *     the sample size attached, because a confident claim built on four
 *     commitments teaches someone the wrong thing about themselves.
 *
 * Every number here comes from lib/metrics. Nothing is invented.
 */

import {
  type ClientMetrics,
  computeCalibration,
  computeClientMetrics,
  followThroughOf,
  formatRate,
  isResolved,
  tallyReasons,
} from '@/lib/metrics';
import { type IsoDate, daysBetweenDates, isoWeekday } from '@/lib/metrics/dates';
import type { CommitmentFact } from '@/lib/types';

export type InsightStage = 'first_days' | 'early_patterns' | 'context' | 'behaviour_model';

export type ClientInsightType =
  | 'summary'
  | 'timing'
  | 'reason'
  | 'calibration'
  | 'weekday'
  | 'size'
  | 'strength';

export interface ClientInsightCard {
  /** Stable across runs, so a dismissed card stays dismissed. */
  key: string;
  type: ClientInsightType;
  title: string;
  summary: string;
  evidence: string[];
  /** The "Try this next" line. Null when the honest answer is "keep going". */
  suggestion: string | null;
  /** True while the sample is too thin to state the finding plainly. */
  provisional: boolean;
}

export interface ClientInsightResult {
  stage: InsightStage;
  daysOfData: number;
  cards: ClientInsightCard[];
}

/** How much history exists, measured from the first recorded commitment. */
export function daysOfHistory(facts: CommitmentFact[], referenceDate: IsoDate): number {
  if (facts.length === 0) return 0;
  const earliest = facts.reduce(
    (oldest, fact) => (fact.commitment_date < oldest ? fact.commitment_date : oldest),
    facts[0].commitment_date,
  );
  return daysBetweenDates(earliest, referenceDate) + 1;
}

export function stageFor(days: number): InsightStage {
  if (days <= 3) return 'first_days';
  if (days <= 7) return 'early_patterns';
  if (days <= 30) return 'context';
  return 'behaviour_model';
}

const EVENING_CUTOFF_HOUR = 19; // 7 PM

function madeBeforeEvening(fact: CommitmentFact): boolean {
  return fact.created_hour_local !== null && fact.created_hour_local < EVENING_CUTOFF_HOUR;
}

// ---------------------------------------------------------------------------
// Individual cards
// ---------------------------------------------------------------------------

function summaryCard(metrics: ClientMetrics, facts: CommitmentFact[]): ClientInsightCard | null {
  const window = metrics.followThrough7.eligible > 0 ? metrics.followThrough7 : followThroughOf(facts);
  if (window.eligible === 0) return null;

  const label = metrics.followThrough7.eligible > 0 ? 'this week' : 'so far';

  return {
    key: 'summary',
    type: 'summary',
    title: `You completed ${window.completed} of ${window.eligible} commitments ${label}.`,
    summary:
      window.changed > 0
        ? `${window.changed} changed along the way, which is information too. What changed is usually more useful than whether it changed.`
        : 'Keep recording what happens. Patterns start to show up after about a week.',
    evidence: [`${window.completed} went to plan`, `${window.changed} changed`, `${window.missed} did not happen`],
    suggestion: null,
    provisional: false,
  };
}

/**
 * When a commitment is made, against whether it happens.
 *
 * Reported as two rates rather than a single "x% more likely", because a
 * relative uplift hides its own base — and someone reading this about
 * themselves deserves the actual numbers.
 */
function timingCard(facts: CommitmentFact[], minPerSide: number): ClientInsightCard | null {
  const resolved = facts.filter(isResolved).filter((f) => f.created_hour_local !== null);
  const early = resolved.filter(madeBeforeEvening);
  const late = resolved.filter((f) => !madeBeforeEvening(f));

  if (early.length < minPerSide || late.length < minPerSide) return null;

  const earlyRate = followThroughOf(early);
  const lateRate = followThroughOf(late);
  if (earlyRate.rate === null || lateRate.rate === null) return null;

  const gap = earlyRate.rate - lateRate.rate;
  if (Math.abs(gap) < 0.2) return null;

  const earlyIsBetter = gap > 0;
  const provisional = early.length + late.length < 12;

  return {
    key: 'timing:evening',
    type: 'timing',
    title: earlyIsBetter
      ? 'Commitments you make before 7 PM go to plan more often'
      : 'Commitments you make later in the evening go to plan more often',
    summary:
      `Made before 7 PM: ${formatRate(earlyRate.rate)} happened. ` +
      `Made after 7 PM: ${formatRate(lateRate.rate)}. ` +
      (provisional
        ? 'That is an early signal rather than a settled pattern, based on a small number of commitments so far.'
        : 'When you decide seems to matter as much as what you decide.'),
    evidence: [
      `Before 7 PM: ${earlyRate.completed} of ${earlyRate.eligible}`,
      `After 7 PM: ${lateRate.completed} of ${lateRate.eligible}`,
    ],
    suggestion: earlyIsBetter
      ? 'Set tomorrow’s commitment before you finish work, rather than last thing at night.'
      : null,
    provisional,
  };
}

function weekdayCard(facts: CommitmentFact[], minPerSide: number): ClientInsightCard | null {
  const resolved = facts.filter(isResolved);
  const weekend = resolved.filter((f) => isoWeekday(f.commitment_date) >= 6);
  const weekday = resolved.filter((f) => isoWeekday(f.commitment_date) < 6);
  if (weekend.length < minPerSide || weekday.length < minPerSide) return null;

  const weekendRate = followThroughOf(weekend);
  const weekdayRate = followThroughOf(weekday);
  if (weekendRate.rate === null || weekdayRate.rate === null) return null;

  const gap = weekdayRate.rate - weekendRate.rate;
  if (Math.abs(gap) < 0.2) return null;

  const weekendsHarder = gap > 0;
  const provisional = weekend.length < 5;

  return {
    key: 'weekday:weekend',
    type: 'weekday',
    title: weekendsHarder ? 'Weekends look different from weekdays' : 'Weekends are working better than weekdays',
    summary:
      `Weekdays: ${formatRate(weekdayRate.rate)} of your commitments happened. ` +
      `Weekends: ${formatRate(weekendRate.rate)}. ` +
      (provisional ? 'Still an early signal. There are only a few weekend days recorded so far.' : ''),
    evidence: [
      `Weekdays: ${weekdayRate.completed} of ${weekdayRate.eligible}`,
      `Weekends: ${weekendRate.completed} of ${weekendRate.eligible}`,
    ],
    suggestion: weekendsHarder
      ? 'Try making weekend commitments smaller and more specific than weekday ones.'
      : null,
    provisional,
  };
}

function reasonCard(facts: CommitmentFact[]): ClientInsightCard | null {
  const nonCompleted = facts.filter((f) => isResolved(f) && f.status !== 'completed');
  if (nonCompleted.length < 4) return null;

  const [top] = tallyReasons(facts);
  if (!top || top.count < 3 || top.share < 0.35) return null;

  return {
    key: `reason:${top.slug}`,
    type: 'reason',
    title: `${top.name} came up in ${top.count} of your last ${nonCompleted.length} changed or missed commitments`,
    summary:
      `That does not mean ${top.name.toLowerCase()} caused it. It means the two keep showing up together. ` +
      'It might be worth planning differently for the days you expect it.',
    evidence: [`${top.name}: ${top.count} times`, `${nonCompleted.length} commitments did not go to plan`],
    suggestion: `Decide now what a smaller version of your commitment looks like on a ${top.name.toLowerCase()} day.`,
    provisional: nonCompleted.length < 6,
  };
}

function calibrationCard(facts: CommitmentFact[]): ClientInsightCard | null {
  const calibration = computeCalibration(facts);
  if (calibration.sampleSize < 8 || calibration.predicted === null || calibration.actual === null) {
    return null;
  }
  const gap = calibration.gap ?? 0;
  if (Math.abs(gap) < 0.15) return null;

  const optimistic = gap > 0;

  return {
    key: 'calibration',
    type: 'calibration',
    title: optimistic
      ? `You rate your commitments around ${formatRate(calibration.predicted)}, and about ${formatRate(calibration.actual)} happen`
      : `You are doing more than you expect: ${formatRate(calibration.actual)} happen against ${formatRate(calibration.predicted)} predicted`,
    summary: optimistic
      ? 'That gap usually says something about how big the commitment was, not about how much you wanted it.'
      : 'Your sense of what is realistic may be more cautious than it needs to be.',
    evidence: [
      `Average confidence when committing: ${formatRate(calibration.predicted)}`,
      `Actually happened: ${formatRate(calibration.actual)}`,
      `Across ${calibration.sampleSize} commitments`,
    ],
    suggestion: optimistic
      ? 'For a week, make each commitment about half the size and see what the number does.'
      : 'Try making one commitment slightly more ambitious than feels comfortable.',
    provisional: false,
  };
}

function strengthCard(metrics: ClientMetrics): ClientInsightCard | null {
  const window = metrics.followThrough30;
  if (window.eligible < 10 || window.rate === null || window.rate < 0.85) return null;

  return {
    key: 'strength',
    type: 'strength',
    title: `${window.completed} of your last ${window.eligible} commitments went to plan`,
    summary: 'Whatever you are doing is working. This is a good moment to ask for a bit more of yourself.',
    evidence: [`Last 30 days: ${formatRate(window.rate)}`],
    suggestion: 'Pick one commitment and make it slightly bigger this week.',
    provisional: false,
  };
}

/**
 * The 30-day picture: the conditions under which this person follows through,
 * assembled only from the comparisons that actually cleared their thresholds.
 */
function behaviourModelCard(facts: CommitmentFact[]): ClientInsightCard | null {
  const resolved = facts.filter(isResolved);
  if (resolved.length < 25) return null;

  const overall = followThroughOf(resolved);
  if (overall.rate === null) return null;

  const conditions: string[] = [];
  const evidence: string[] = [];

  const withHour = resolved.filter((f) => f.created_hour_local !== null);
  const early = withHour.filter(madeBeforeEvening);
  const late = withHour.filter((f) => !madeBeforeEvening(f));
  if (early.length >= 6 && late.length >= 6) {
    const earlyRate = followThroughOf(early).rate;
    const lateRate = followThroughOf(late).rate;
    if (earlyRate !== null && lateRate !== null && earlyRate - lateRate >= 0.15) {
      conditions.push('you decide before the evening');
      evidence.push(`Decided before 7 PM: ${formatRate(earlyRate)} vs ${formatRate(lateRate)} later`);
    }
  }

  const weekday = resolved.filter((f) => isoWeekday(f.commitment_date) < 6);
  const weekend = resolved.filter((f) => isoWeekday(f.commitment_date) >= 6);
  if (weekday.length >= 6 && weekend.length >= 6) {
    const weekdayRate = followThroughOf(weekday).rate;
    const weekendRate = followThroughOf(weekend).rate;
    if (weekdayRate !== null && weekendRate !== null && weekdayRate - weekendRate >= 0.15) {
      conditions.push('the day has a normal shape to it');
      evidence.push(`Weekdays: ${formatRate(weekdayRate)} vs weekends ${formatRate(weekendRate)}`);
    }
  }

  const [topReason] = tallyReasons(facts);
  if (topReason && topReason.count >= 4) {
    conditions.push(`${topReason.name.toLowerCase()} is not in the way`);
    evidence.push(`${topReason.name} appeared ${topReason.count} times when plans changed`);
  }

  if (conditions.length < 2) return null;

  const list =
    conditions.length === 2
      ? `${conditions[0]} and ${conditions[1]}`
      : `${conditions.slice(0, -1).join(', ')}, and ${conditions[conditions.length - 1]}`;

  return {
    key: 'behaviour_model',
    type: 'size',
    title: 'What your record suggests about you',
    summary:
      `Across ${overall.eligible} commitments, things go to plan most reliably when ${list}. ` +
      'None of that is fixed. It is a description of the conditions so far, not a rule about you.',
    evidence,
    suggestion: 'Set up the next week so those conditions are true more often than not.',
    provisional: false,
  };
}

// ---------------------------------------------------------------------------

/**
 * Builds the cards for a client, appropriate to how much history exists.
 *
 * Thresholds loosen as the record grows: at a week the timing comparison needs
 * only three commitments a side and says out loud that it is provisional; by a
 * month it needs five and can state the finding plainly.
 */
export function buildClientInsights(
  facts: CommitmentFact[],
  options: { referenceDate: IsoDate; metrics?: ClientMetrics },
): ClientInsightResult {
  const { referenceDate } = options;
  const metrics = options.metrics ?? computeClientMetrics({ facts, referenceDate });
  const days = daysOfHistory(facts, referenceDate);
  const stage = stageFor(days);

  const cards: ClientInsightCard[] = [];
  const summary = summaryCard(metrics, facts);
  if (summary) cards.push(summary);

  if (stage === 'early_patterns') {
    // Small samples, so exactly one provisional signal — the most useful one
    // — rather than a wall of half-supported claims.
    const early = timingCard(facts, 3) ?? weekdayCard(facts, 3);
    if (early) cards.push(early);
  }

  if (stage === 'context' || stage === 'behaviour_model') {
    const timing = timingCard(facts, 5);
    if (timing) cards.push(timing);

    const weekend = weekdayCard(facts, 5);
    if (weekend) cards.push(weekend);

    const reason = reasonCard(facts);
    if (reason) cards.push(reason);

    const calibration = calibrationCard(facts);
    if (calibration) cards.push(calibration);
  }

  if (stage === 'behaviour_model') {
    const model = behaviourModelCard(facts);
    if (model) cards.unshift(model);
  }

  const strength = strengthCard(metrics);
  if (strength) cards.push(strength);

  return { stage, daysOfData: days, cards };
}

/** The single line the Today screen shows. Never the summary count — that is already on screen. */
export function headlineInsight(result: ClientInsightResult): ClientInsightCard | null {
  return result.cards.find((card) => card.type !== 'summary') ?? null;
}

export { EVENING_CUTOFF_HOUR };
