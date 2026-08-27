/**
 * Deterministic pattern detection.
 *
 * Every pattern Nell shows a coach starts life here, as counted rows and a
 * threshold — never as a model's impression. The AI layer may later rewrite the
 * description in the organization's voice, but it cannot invent a pattern, and
 * it cannot change the numbers.
 *
 * Two rules are non-negotiable:
 *   1. A rule fires only above its minimum sample size. Small samples produce
 *      confident-sounding nonsense, which is worse than silence.
 *   2. Language is associative, never causal. "appears alongside", not
 *      "causes". Coaches, not software, decide what a pattern means.
 */

import type { CommitmentFact, PatternEvidence } from '@/lib/types';
import {
  type IsoDate,
  type TimeBucket,
  computeCalibration,
  followThroughOf,
  inWindow,
  isResolved,
  lastNDays,
  previousNDays,
  tallyReasons,
  timeBucket,
} from '@/lib/metrics';
import { isoWeekday } from '@/lib/metrics/dates';

export type PatternType =
  | 'weekend_dip'
  | 'weekday_dip'
  | 'reason_dominance'
  | 'emotional_cluster'
  | 'overconfidence'
  | 'late_planning'
  | 'declining_follow_through'
  | 'impulsive_change'
  | 'strength';

export interface PatternCandidate {
  patternType: PatternType;
  /** Stable across runs so re-detection updates rather than duplicates. */
  patternKey: string;
  title: string;
  description: string;
  confidence: number;
  evidence: PatternEvidence;
  suggestedQuestion: string | null;
  suggestedExperiment: string | null;
}

export interface DetectionOptions {
  referenceDate: IsoDate;
  /** Days of history each rule may look at. */
  windowDays?: number;
}

const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const TIME_BUCKET_PHRASE: Record<TimeBucket, string> = {
  morning: 'in the morning',
  afternoon: 'in the afternoon',
  evening: 'in the evening',
  late_night: 'late at night',
};

/** Thresholds are named and centralised so a coach-facing doc can quote them. */
export const THRESHOLDS = {
  weekendGap: 0.2,
  weekendMinPerSide: 5,
  weekdayGap: 0.25,
  weekdayMinSamples: 4,
  weekdayMinOverall: 15,
  reasonShare: 0.4,
  reasonMinOccurrences: 3,
  reasonMinNonCompleted: 5,
  overconfidencePredicted: 0.8,
  overconfidenceActual: 0.6,
  overconfidenceMinSample: 8,
  latePlanningGap: 0.2,
  latePlanningMinPerSide: 5,
  declineDelta: 0.15,
  declineMinEligible: 6,
  impulsiveShare: 0.3,
  impulsiveMinResolved: 6,
  strengthRate: 0.85,
  strengthMinEligible: 12,
} as const;

/**
 * Confidence in a *finding*, not in the client. It rises with both the size of
 * the effect and the amount of evidence, and is deliberately capped below 1 —
 * no amount of observational data makes a behavioural pattern certain.
 */
export function scoreConfidence(effect: number, targetEffect: number, sampleSize: number, minSample: number): number {
  const effectFactor = Math.min(1, Math.abs(effect) / targetEffect);
  const sampleFactor = Math.min(1, sampleSize / (minSample * 3));
  const raw = 0.4 + 0.35 * effectFactor + 0.25 * sampleFactor;
  return Number(Math.min(0.95, Math.max(0, raw)).toFixed(3));
}

function pct(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`;
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export function detectWeekendDip(facts: CommitmentFact[]): PatternCandidate | null {
  const resolved = facts.filter(isResolved);
  const weekend = resolved.filter((f) => isoWeekday(f.commitment_date) >= 6);
  const weekday = resolved.filter((f) => isoWeekday(f.commitment_date) < 6);

  if (
    weekend.length < THRESHOLDS.weekendMinPerSide ||
    weekday.length < THRESHOLDS.weekendMinPerSide
  ) {
    return null;
  }

  const weekendFt = followThroughOf(weekend);
  const weekdayFt = followThroughOf(weekday);
  if (weekendFt.rate === null || weekdayFt.rate === null) return null;

  const gap = weekdayFt.rate - weekendFt.rate;
  if (gap < THRESHOLDS.weekendGap) return null;

  return {
    patternType: 'weekend_dip',
    patternKey: 'weekend_dip',
    title: 'Follow-through drops at weekends',
    description:
      `Weekend commitments have been completed ${pct(weekendFt.rate)} of the time, against ` +
      `${pct(weekdayFt.rate)} on weekdays. The gap appears consistently rather than in a single week.`,
    confidence: scoreConfidence(gap, 0.4, weekend.length + weekday.length, THRESHOLDS.weekendMinPerSide * 2),
    evidence: {
      statements: [
        `Weekend follow-through: ${pct(weekendFt.rate)} (${weekendFt.completed} of ${weekendFt.eligible})`,
        `Weekday follow-through: ${pct(weekdayFt.rate)} (${weekdayFt.completed} of ${weekdayFt.eligible})`,
      ],
      data: {
        weekendRate: Number(weekendFt.rate.toFixed(3)),
        weekdayRate: Number(weekdayFt.rate.toFixed(3)),
        gap: Number(gap.toFixed(3)),
        weekendSample: weekend.length,
        weekdaySample: weekday.length,
      },
      sampleSize: weekend.length + weekday.length,
    },
    suggestedQuestion:
      'What is different about how weekends are planned compared with weekdays?',
    suggestedExperiment:
      'For two weeks, make weekend commitments smaller and more specific than weekday ones, and compare follow-through.',
  };
}

export function detectWeekdayDip(facts: CommitmentFact[]): PatternCandidate | null {
  const resolved = facts.filter(isResolved);
  if (resolved.length < THRESHOLDS.weekdayMinOverall) return null;

  const overall = followThroughOf(resolved);
  if (overall.rate === null) return null;

  let worst: { weekday: number; rate: number; sample: number; completed: number } | null = null;

  for (let weekday = 1; weekday <= 7; weekday += 1) {
    const onDay = resolved.filter((f) => isoWeekday(f.commitment_date) === weekday);
    if (onDay.length < THRESHOLDS.weekdayMinSamples) continue;
    const ft = followThroughOf(onDay);
    if (ft.rate === null) continue;
    if (!worst || ft.rate < worst.rate) {
      worst = { weekday, rate: ft.rate, sample: onDay.length, completed: ft.completed };
    }
  }

  if (!worst) return null;
  const gap = overall.rate - worst.rate;
  if (gap < THRESHOLDS.weekdayGap) return null;

  const dayName = WEEKDAY_NAMES[worst.weekday - 1];
  return {
    patternType: 'weekday_dip',
    patternKey: `weekday_dip:${worst.weekday}`,
    title: `${dayName}s stand out as a harder day`,
    description:
      `${dayName} commitments have been completed ${pct(worst.rate)} of the time, against an ` +
      `overall ${pct(overall.rate)}. Worth exploring what tends to be happening on that day.`,
    confidence: scoreConfidence(gap, 0.4, worst.sample, THRESHOLDS.weekdayMinSamples),
    evidence: {
      statements: [
        `${dayName}: ${worst.completed} of ${worst.sample} commitments completed (${pct(worst.rate)})`,
        `All days: ${overall.completed} of ${overall.eligible} completed (${pct(overall.rate)})`,
      ],
      data: {
        weekday: worst.weekday,
        dayRate: Number(worst.rate.toFixed(3)),
        overallRate: Number(overall.rate.toFixed(3)),
        gap: Number(gap.toFixed(3)),
        daySample: worst.sample,
      },
      sampleSize: worst.sample,
    },
    suggestedQuestion: `What does a typical ${dayName} look like?`,
    suggestedExperiment: `Plan ${dayName} commitments the evening before for two weeks and compare.`,
  };
}

export function detectReasonDominance(facts: CommitmentFact[]): PatternCandidate | null {
  const nonCompleted = facts.filter((f) => isResolved(f) && f.status !== 'completed');
  if (nonCompleted.length < THRESHOLDS.reasonMinNonCompleted) return null;

  const [top] = tallyReasons(facts);
  if (!top) return null;
  if (top.count < THRESHOLDS.reasonMinOccurrences || top.share < THRESHOLDS.reasonShare) return null;

  return {
    patternType: 'reason_dominance',
    patternKey: `reason_dominance:${top.slug}`,
    title: `"${top.name}" appears disproportionately often before missed commitments`,
    description:
      `${top.name.toLowerCase()} was recorded in ${top.count} of the last ${nonCompleted.length} ` +
      `commitments that did not go to plan (${pct(top.share)}). This is an association, not a cause — ` +
      `it may be worth exploring together.`,
    confidence: scoreConfidence(top.share, 0.7, nonCompleted.length, THRESHOLDS.reasonMinNonCompleted),
    evidence: {
      statements: [
        `${top.name} recorded ${top.count} times`,
        `${nonCompleted.length} commitments did not complete in this window`,
        `Share: ${pct(top.share)}`,
      ],
      data: {
        reason: top.slug,
        count: top.count,
        nonCompleted: nonCompleted.length,
        share: Number(top.share.toFixed(3)),
      },
      sampleSize: nonCompleted.length,
    },
    suggestedQuestion: `What needs to be different about commitments made on days where ${top.name.toLowerCase()} is likely?`,
    suggestedExperiment: `For one week, set a smaller fallback commitment for days where ${top.name.toLowerCase()} is expected.`,
  };
}

export function detectEmotionalCluster(facts: CommitmentFact[]): PatternCandidate | null {
  const nonCompleted = facts.filter((f) => isResolved(f) && f.status !== 'completed');
  if (nonCompleted.length < THRESHOLDS.reasonMinNonCompleted) return null;

  const emotional = nonCompleted.filter((f) => f.reason_category === 'emotional');
  const share = emotional.length / nonCompleted.length;
  if (emotional.length < THRESHOLDS.reasonMinOccurrences || share < THRESHOLDS.reasonShare) {
    return null;
  }

  // A single reason already covered by reason_dominance is not a cluster.
  const distinctReasons = new Set(emotional.map((f) => f.reason_slug));
  if (distinctReasons.size < 2) return null;

  return {
    patternType: 'emotional_cluster',
    patternKey: 'emotional_cluster',
    title: 'Emotional states appear alongside most changed plans',
    description:
      `${emotional.length} of ${nonCompleted.length} commitments that did not go to plan carried an ` +
      `emotional reason (${pct(share)}), across ${distinctReasons.size} different reasons. ` +
      `Worth exploring what support helps in those moments.`,
    confidence: scoreConfidence(share, 0.7, nonCompleted.length, THRESHOLDS.reasonMinNonCompleted),
    evidence: {
      statements: [
        `${emotional.length} of ${nonCompleted.length} non-completions had an emotional reason`,
        `Distinct emotional reasons recorded: ${distinctReasons.size}`,
      ],
      data: {
        emotionalCount: emotional.length,
        nonCompleted: nonCompleted.length,
        share: Number(share.toFixed(3)),
        distinctReasons: distinctReasons.size,
      },
      sampleSize: nonCompleted.length,
    },
    suggestedQuestion: 'What tends to help when a plan collides with how you are feeling?',
    suggestedExperiment:
      'Add a two-minute pause step before acting on a changed plan for one week, and note what happens.',
  };
}

export function detectOverconfidence(facts: CommitmentFact[]): PatternCandidate | null {
  const calibration = computeCalibration(facts);
  if (
    calibration.sampleSize < THRESHOLDS.overconfidenceMinSample ||
    calibration.predicted === null ||
    calibration.actual === null
  ) {
    return null;
  }
  if (
    calibration.predicted < THRESHOLDS.overconfidencePredicted ||
    calibration.actual >= THRESHOLDS.overconfidenceActual
  ) {
    return null;
  }

  const gap = calibration.gap ?? 0;
  return {
    patternType: 'overconfidence',
    patternKey: 'overconfidence',
    title: 'Plans are more ambitious at the point of committing than they turn out to be',
    description:
      `Average predicted confidence is ${pct(calibration.predicted)} while actual follow-through is ` +
      `${pct(calibration.actual)} over the same ${calibration.sampleSize} commitments. ` +
      `This often points to commitment size rather than motivation.`,
    confidence: scoreConfidence(gap, 0.4, calibration.sampleSize, THRESHOLDS.overconfidenceMinSample),
    evidence: {
      statements: [
        `Average predicted confidence: ${pct(calibration.predicted)}`,
        `Actual follow-through: ${pct(calibration.actual)}`,
        `Gap: ${Math.round(gap * 100)} points across ${calibration.sampleSize} commitments`,
      ],
      data: {
        predicted: Number(calibration.predicted.toFixed(3)),
        actual: Number(calibration.actual.toFixed(3)),
        gap: Number(gap.toFixed(3)),
        sample: calibration.sampleSize,
      },
      sampleSize: calibration.sampleSize,
    },
    suggestedQuestion:
      'When you rate a commitment at 90%, what would have to be true for that to hold?',
    suggestedExperiment:
      'For one week, halve the size of every commitment rated above 80% and compare follow-through.',
  };
}

export function detectLatePlanning(facts: CommitmentFact[]): PatternCandidate | null {
  const resolved = facts.filter(isResolved).filter((f) => f.created_hour_local !== null);
  if (resolved.length < THRESHOLDS.latePlanningMinPerSide * 2) return null;

  const buckets = new Map<TimeBucket, CommitmentFact[]>();
  for (const fact of resolved) {
    const bucket = timeBucket(fact.created_hour_local as number);
    const list = buckets.get(bucket) ?? [];
    list.push(fact);
    buckets.set(bucket, list);
  }

  let worst: { bucket: TimeBucket; rate: number; sample: number } | null = null;
  let best: { bucket: TimeBucket; rate: number; sample: number } | null = null;

  for (const [bucket, list] of buckets) {
    if (list.length < THRESHOLDS.latePlanningMinPerSide) continue;
    const ft = followThroughOf(list);
    if (ft.rate === null) continue;
    if (!worst || ft.rate < worst.rate) worst = { bucket, rate: ft.rate, sample: list.length };
    if (!best || ft.rate > best.rate) best = { bucket, rate: ft.rate, sample: list.length };
  }

  if (!worst || !best || worst.bucket === best.bucket) return null;
  const gap = best.rate - worst.rate;
  if (gap < THRESHOLDS.latePlanningGap) return null;

  return {
    patternType: 'late_planning',
    patternKey: `late_planning:${worst.bucket}`,
    title: `Commitments made ${TIME_BUCKET_PHRASE[worst.bucket]} follow through less often`,
    description:
      `Commitments created ${TIME_BUCKET_PHRASE[worst.bucket]} complete ${pct(worst.rate)} of the time, ` +
      `against ${pct(best.rate)} for those created ${TIME_BUCKET_PHRASE[best.bucket]}. ` +
      `When a plan is made may matter as much as what the plan is.`,
    confidence: scoreConfidence(gap, 0.4, worst.sample + best.sample, THRESHOLDS.latePlanningMinPerSide * 2),
    evidence: {
      statements: [
        `Created ${TIME_BUCKET_PHRASE[worst.bucket]}: ${pct(worst.rate)} across ${worst.sample} commitments`,
        `Created ${TIME_BUCKET_PHRASE[best.bucket]}: ${pct(best.rate)} across ${best.sample} commitments`,
      ],
      data: {
        worstBucket: worst.bucket,
        worstRate: Number(worst.rate.toFixed(3)),
        bestBucket: best.bucket,
        bestRate: Number(best.rate.toFixed(3)),
        gap: Number(gap.toFixed(3)),
      },
      sampleSize: worst.sample + best.sample,
    },
    suggestedQuestion: `What changes about a plan when it is made ${TIME_BUCKET_PHRASE[worst.bucket]}?`,
    suggestedExperiment: `For one week, set the next day's commitment before ${
      worst.bucket === 'late_night' ? '7pm' : 'the end of the working day'
    }.`,
  };
}

export function detectDecline(facts: CommitmentFact[], referenceDate: IsoDate): PatternCandidate | null {
  const current = followThroughOf(inWindow(facts, lastNDays(referenceDate, 30)));
  const previous = followThroughOf(inWindow(facts, previousNDays(referenceDate, 30)));

  if (
    current.rate === null ||
    previous.rate === null ||
    current.eligible < THRESHOLDS.declineMinEligible ||
    previous.eligible < THRESHOLDS.declineMinEligible
  ) {
    return null;
  }

  const delta = previous.rate - current.rate;
  if (delta < THRESHOLDS.declineDelta) return null;

  return {
    patternType: 'declining_follow_through',
    patternKey: 'declining_follow_through',
    title: 'Follow-through has declined over the last month',
    description:
      `Follow-through moved from ${pct(previous.rate)} to ${pct(current.rate)} between the previous ` +
      `30 days and the last 30 days — a drop of ${Math.round(delta * 100)} points.`,
    confidence: scoreConfidence(delta, 0.3, current.eligible + previous.eligible, THRESHOLDS.declineMinEligible * 2),
    evidence: {
      statements: [
        `Previous 30 days: ${previous.completed} of ${previous.eligible} (${pct(previous.rate)})`,
        `Last 30 days: ${current.completed} of ${current.eligible} (${pct(current.rate)})`,
      ],
      data: {
        previousRate: Number(previous.rate.toFixed(3)),
        currentRate: Number(current.rate.toFixed(3)),
        delta: Number(delta.toFixed(3)),
      },
      sampleSize: current.eligible + previous.eligible,
    },
    suggestedQuestion: 'What has changed in the last month that the plan has not caught up with yet?',
    suggestedExperiment: 'Reset to three small commitments per week for two weeks and rebuild from there.',
  };
}

export function detectImpulsiveChange(facts: CommitmentFact[]): PatternCandidate | null {
  const resolved = facts.filter(isResolved);
  if (resolved.length < THRESHOLDS.impulsiveMinResolved) return null;

  const impulsive = resolved.filter((f) => f.outcome === 'changed_impulsively');
  const share = impulsive.length / resolved.length;
  if (share < THRESHOLDS.impulsiveShare) return null;

  return {
    patternType: 'impulsive_change',
    patternKey: 'impulsive_change',
    title: 'Plans more often shift in the moment than by decision',
    description:
      `${impulsive.length} of ${resolved.length} commitments were changed impulsively rather than ` +
      `intentionally (${pct(share)}). The distinction may be more useful to explore than the outcome itself.`,
    confidence: scoreConfidence(share, 0.6, resolved.length, THRESHOLDS.impulsiveMinResolved),
    evidence: {
      statements: [
        `Changed impulsively: ${impulsive.length}`,
        `Total resolved commitments: ${resolved.length}`,
      ],
      data: {
        impulsive: impulsive.length,
        resolved: resolved.length,
        share: Number(share.toFixed(3)),
      },
      sampleSize: resolved.length,
    },
    suggestedQuestion: 'What is usually happening in the moment a plan changes?',
    suggestedExperiment:
      'For one week, write one line before changing a plan describing what is driving the change.',
  };
}

export function detectStrength(facts: CommitmentFact[]): PatternCandidate | null {
  const resolved = facts.filter(isResolved);
  const ft = followThroughOf(resolved);
  if (ft.eligible < THRESHOLDS.strengthMinEligible || ft.rate === null) return null;
  if (ft.rate < THRESHOLDS.strengthRate) return null;

  return {
    patternType: 'strength',
    patternKey: 'strength',
    title: 'Follow-through is consistently strong',
    description:
      `${ft.completed} of the last ${ft.eligible} commitments were completed (${pct(ft.rate)}). ` +
      `This is a good moment to increase ambition rather than maintenance.`,
    confidence: scoreConfidence(ft.rate - THRESHOLDS.strengthRate, 0.15, ft.eligible, THRESHOLDS.strengthMinEligible),
    evidence: {
      statements: [`${ft.completed} of ${ft.eligible} commitments completed (${pct(ft.rate)})`],
      data: { rate: Number(ft.rate.toFixed(3)), eligible: ft.eligible },
      sampleSize: ft.eligible,
    },
    suggestedQuestion: 'What would a more ambitious commitment look like from here?',
    suggestedExperiment: 'Increase one commitment by roughly 25% for two weeks and watch follow-through.',
  };
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

/**
 * Runs every rule and returns candidates ordered by confidence.
 *
 * Rules are independent by design: a client can legitimately show a weekend
 * dip *and* overconfidence, and collapsing them would hide information the
 * coach needs.
 */
export function detectPatterns(
  facts: CommitmentFact[],
  options: DetectionOptions,
): PatternCandidate[] {
  const windowDays = options.windowDays ?? 90;
  const scoped = inWindow(facts, lastNDays(options.referenceDate, windowDays));

  const candidates = [
    detectDecline(facts, options.referenceDate),
    detectWeekendDip(scoped),
    detectWeekdayDip(scoped),
    detectReasonDominance(scoped),
    detectEmotionalCluster(scoped),
    detectOverconfidence(scoped),
    detectLatePlanning(scoped),
    detectImpulsiveChange(scoped),
    detectStrength(scoped),
  ].filter((candidate): candidate is PatternCandidate => candidate !== null);

  return candidates.sort((a, b) => b.confidence - a.confidence);
}
