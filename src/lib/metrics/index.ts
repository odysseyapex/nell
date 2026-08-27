/**
 * Deterministic client metrics.
 *
 * Everything here is a pure function over rows read from Postgres. No model is
 * ever asked to count, divide or compare — the AI layer receives the output of
 * these functions and is only allowed to put them into words.
 *
 * Definitions used throughout:
 *
 *   eligible      A commitment that has resolved: completed, changed or missed.
 *                 Still-planned and cancelled commitments are excluded so that
 *                 an open commitment never silently counts as a failure.
 *
 *   followThrough completed / eligible. A change is not a completion — but it
 *                 is also not a miss, which is why changeRate is reported
 *                 separately rather than folded in.
 */

import type { CommitmentFact, ExerciseEntry } from '@/lib/types';
import {
  type DateWindow,
  type IsoDate,
  type TimeBucket,
  isWithin,
  isoWeekday,
  lastNDays,
  previousNDays,
  timeBucket,
} from './dates';

export const RESOLVED_STATUSES = ['completed', 'changed', 'missed'] as const;

export interface FollowThrough {
  completed: number;
  changed: number;
  missed: number;
  eligible: number;
  /** null when there is nothing to divide by — never 0, which would read as failure. */
  rate: number | null;
}

export type TrendDirection = 'improving' | 'steady' | 'declining' | 'unknown';

export interface Calibration {
  /** Mean predicted confidence, 0–1. */
  predicted: number | null;
  /** Actual follow-through over the same commitments, 0–1. */
  actual: number | null;
  /** predicted − actual. Positive means plans were more optimistic than outcomes. */
  gap: number | null;
  sampleSize: number;
}

export interface ReasonTally {
  slug: string;
  name: string;
  category: string;
  count: number;
  /** Share of non-completed commitments carrying this reason, 0–1. */
  share: number;
}

export interface BreakdownBucket<K extends string | number> {
  key: K;
  label: string;
  followThrough: FollowThrough;
}

export interface ClientMetrics {
  referenceDate: IsoDate;
  followThrough7: FollowThrough;
  followThrough30: FollowThrough;
  followThrough90: FollowThrough;
  followThroughPrev30: FollowThrough;
  trend: TrendDirection;
  /** Change in 30-day follow-through vs the preceding 30 days, in rate points. */
  trendDelta: number | null;
  calibration: Calibration;
  confidenceAverage: number | null;
  changeRate30: number | null;
  missRate30: number | null;
  commitmentsCreated30: number;
  commitmentCreationRatePerWeek: number;
  openCommitments: number;
  overdueCheckins: number;
  byWeekday: BreakdownBucket<number>[];
  byTimeOfDay: BreakdownBucket<TimeBucket>[];
  topReasons: ReasonTally[];
  exerciseCompletion30: number | null;
  daysSinceLastActivity: number | null;
}

const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const TIME_BUCKET_ORDER: TimeBucket[] = ['morning', 'afternoon', 'evening', 'late_night'];
const TIME_BUCKET_SHORT: Record<TimeBucket, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
  late_night: 'Late night',
};

export function isResolved(fact: CommitmentFact): boolean {
  return (RESOLVED_STATUSES as readonly string[]).includes(fact.status);
}

/** Follow-through over an arbitrary set of commitment facts. */
export function followThroughOf(facts: CommitmentFact[]): FollowThrough {
  let completed = 0;
  let changed = 0;
  let missed = 0;

  for (const fact of facts) {
    if (fact.status === 'completed') completed += 1;
    else if (fact.status === 'changed') changed += 1;
    else if (fact.status === 'missed') missed += 1;
  }

  const eligible = completed + changed + missed;
  return { completed, changed, missed, eligible, rate: eligible === 0 ? null : completed / eligible };
}

export function inWindow(facts: CommitmentFact[], window: DateWindow): CommitmentFact[] {
  return facts.filter((fact) => isWithin(fact.commitment_date, window));
}

export function followThroughInWindow(
  facts: CommitmentFact[],
  end: IsoDate,
  days: number,
): FollowThrough {
  return followThroughOf(inWindow(facts, lastNDays(end, days)));
}

/**
 * Confidence calibration: what the client predicted against what happened.
 *
 * Only commitments that both carry a confidence score and have resolved are
 * counted, so the two halves of the comparison always describe the same rows.
 */
export function computeCalibration(facts: CommitmentFact[]): Calibration {
  const usable = facts.filter((f) => isResolved(f) && f.confidence_score !== null);
  if (usable.length === 0) {
    return { predicted: null, actual: null, gap: null, sampleSize: 0 };
  }

  const predicted =
    usable.reduce((sum, f) => sum + (f.confidence_score ?? 0), 0) / usable.length / 100;
  const actual = followThroughOf(usable).rate;

  return {
    predicted,
    actual,
    gap: actual === null ? null : predicted - actual,
    sampleSize: usable.length,
  };
}

/**
 * Trend is reported in plain rate points, not as a percentage of a percentage.
 * A move from 0.82 to 0.58 is a delta of −0.24.
 */
export function computeTrend(
  current: FollowThrough,
  previous: FollowThrough,
  threshold = 0.08,
): { direction: TrendDirection; delta: number | null } {
  if (current.rate === null || previous.rate === null || current.eligible < 3 || previous.eligible < 3) {
    return { direction: 'unknown', delta: null };
  }
  const delta = current.rate - previous.rate;
  if (delta <= -threshold) return { direction: 'declining', delta };
  if (delta >= threshold) return { direction: 'improving', delta };
  return { direction: 'steady', delta };
}

/** Reasons recorded against commitments that did not complete, most common first. */
export function tallyReasons(facts: CommitmentFact[]): ReasonTally[] {
  const nonCompleted = facts.filter((f) => isResolved(f) && f.status !== 'completed');
  if (nonCompleted.length === 0) return [];

  const counts = new Map<string, ReasonTally>();
  for (const fact of nonCompleted) {
    if (!fact.reason_slug) continue;
    const existing = counts.get(fact.reason_slug);
    if (existing) {
      existing.count += 1;
    } else {
      counts.set(fact.reason_slug, {
        slug: fact.reason_slug,
        name: fact.reason_name ?? fact.reason_slug,
        category: fact.reason_category ?? 'other',
        count: 1,
        share: 0,
      });
    }
  }

  const tallies = [...counts.values()];
  for (const tally of tallies) tally.share = tally.count / nonCompleted.length;
  return tallies.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function breakdownByWeekday(facts: CommitmentFact[]): BreakdownBucket<number>[] {
  return Array.from({ length: 7 }, (_, index) => {
    const weekday = index + 1;
    return {
      key: weekday,
      label: WEEKDAY_NAMES[index],
      followThrough: followThroughOf(
        facts.filter((f) => isoWeekday(f.commitment_date) === weekday),
      ),
    };
  });
}

export function breakdownByTimeOfDay(facts: CommitmentFact[]): BreakdownBucket<TimeBucket>[] {
  const withHour = facts.filter((f) => f.created_hour_local !== null);
  return TIME_BUCKET_ORDER.map((bucket) => ({
    key: bucket,
    label: TIME_BUCKET_SHORT[bucket],
    followThrough: followThroughOf(
      withHour.filter((f) => timeBucket(f.created_hour_local as number) === bucket),
    ),
  }));
}

export interface MetricsInput {
  facts: CommitmentFact[];
  referenceDate: IsoDate;
  exerciseEntries?: Pick<ExerciseEntry, 'entry_date' | 'status'>[];
  /** Most recent moment of any client activity, ISO timestamp or date. */
  lastActivityAt?: string | null;
}

export function computeClientMetrics(input: MetricsInput): ClientMetrics {
  const { facts, referenceDate } = input;

  const window30 = lastNDays(referenceDate, 30);
  const prev30 = previousNDays(referenceDate, 30);
  const facts30 = inWindow(facts, window30);
  const factsPrev30 = inWindow(facts, prev30);
  const facts90 = inWindow(facts, lastNDays(referenceDate, 90));

  const followThrough30 = followThroughOf(facts30);
  const followThroughPrev30 = followThroughOf(factsPrev30);
  const { direction, delta } = computeTrend(followThrough30, followThroughPrev30);

  const resolved30 = facts30.filter(isResolved);
  const changeRate30 = followThrough30.eligible
    ? followThrough30.changed / followThrough30.eligible
    : null;
  const missRate30 = followThrough30.eligible
    ? followThrough30.missed / followThrough30.eligible
    : null;

  const withConfidence30 = facts30.filter((f) => f.confidence_score !== null);
  const confidenceAverage = withConfidence30.length
    ? withConfidence30.reduce((sum, f) => sum + (f.confidence_score ?? 0), 0) /
      withConfidence30.length
    : null;

  const openCommitments = facts.filter((f) => f.status === 'planned').length;
  const overdueCheckins = facts.filter(
    (f) => f.status === 'planned' && f.commitment_date < referenceDate,
  ).length;

  const entries30 = (input.exerciseEntries ?? []).filter((e) => isWithin(e.entry_date, window30));
  const exerciseCompletion30 = entries30.length
    ? entries30.filter((e) => e.status === 'completed').length / entries30.length
    : null;

  const daysSinceLastActivity = input.lastActivityAt
    ? Math.max(
        0,
        Math.round(
          (Date.parse(`${referenceDate}T23:59:59.999Z`) - Date.parse(input.lastActivityAt)) / 86_400_000,
        ),
      )
    : null;

  return {
    referenceDate,
    followThrough7: followThroughInWindow(facts, referenceDate, 7),
    followThrough30,
    followThrough90: followThroughOf(facts90),
    followThroughPrev30,
    trend: direction,
    trendDelta: delta,
    calibration: computeCalibration(facts90),
    confidenceAverage,
    changeRate30,
    missRate30,
    commitmentsCreated30: facts30.length,
    commitmentCreationRatePerWeek: Number(((facts30.length / 30) * 7).toFixed(2)),
    openCommitments,
    overdueCheckins,
    byWeekday: breakdownByWeekday(facts90),
    byTimeOfDay: breakdownByTimeOfDay(facts90),
    topReasons: tallyReasons(resolved30.length >= 5 ? facts30 : facts90),
    exerciseCompletion30,
    daysSinceLastActivity,
  };
}

/** Follow-through restricted to commitments matching a predicate — used by experiments. */


export function formatRate(rate: number | null, fallback = '—'): string {
  if (rate === null || Number.isNaN(rate)) return fallback;
  return `${Math.round(rate * 100)}%`;
}

export function formatDelta(delta: number | null): string {
  if (delta === null) return '—';
  const points = Math.round(delta * 100);
  return `${points > 0 ? '+' : ''}${points} pts`;
}

export * from './dates';
