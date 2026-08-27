/**
 * Coach alert generation.
 *
 * An alert is a claim on the coach's attention, so the bar is deliberately
 * high: each one carries what changed, the evidence behind it, and a concrete
 * thing the coach could do next. Alerts have stable keys so that a condition
 * which persists across nightly runs stays a single alert rather than becoming
 * a daily drumbeat.
 */

import type { ClientMetrics } from '@/lib/metrics';
import { formatRate } from '@/lib/metrics';
import type { PatternCandidate } from '@/lib/patterns/engine';
import type { AlertSeverity, Experiment } from '@/lib/types';

export interface AlertCandidate {
  alertType: string;
  alertKey: string;
  severity: AlertSeverity;
  title: string;
  description: string;
  recommendedAction: string;
  evidence: Record<string, unknown>;
}

export interface AlertInput {
  metrics: ClientMetrics;
  patterns: PatternCandidate[];
  experiments?: Pick<Experiment, 'id' | 'title' | 'status' | 'end_date' | 'result_metric' | 'baseline_metric'>[];
  clientName?: string;
}

const SEVERITY_RANK: Record<AlertSeverity, number> = { high: 0, medium: 1, low: 2 };

export function generateAlerts(input: AlertInput): AlertCandidate[] {
  const { metrics, patterns } = input;
  const alerts: AlertCandidate[] = [];

  // --- Follow-through decline -------------------------------------------
  if (metrics.trend === 'declining' && metrics.trendDelta !== null) {
    const points = Math.abs(Math.round(metrics.trendDelta * 100));
    alerts.push({
      alertType: 'follow_through_decline',
      alertKey: 'follow_through_decline',
      severity: points >= 20 ? 'high' : 'medium',
      title: `Follow-through down ${points} points`,
      description:
        `30-day follow-through moved from ${formatRate(metrics.followThroughPrev30.rate)} to ` +
        `${formatRate(metrics.followThrough30.rate)}.`,
      recommendedAction:
        'Open the last two weeks of check-ins together and look at what changed, before changing the plan.',
      evidence: {
        previous: metrics.followThroughPrev30,
        current: metrics.followThrough30,
        deltaPoints: metrics.trendDelta,
      },
    });
  }

  // --- Repeated recent misses -------------------------------------------
  if (metrics.followThrough7.missed >= 3) {
    alerts.push({
      alertType: 'repeated_misses',
      alertKey: 'repeated_misses',
      severity: 'high',
      title: `${metrics.followThrough7.missed} missed commitments this week`,
      description: `${metrics.followThrough7.missed} of ${metrics.followThrough7.eligible} commitments in the last 7 days were missed.`,
      recommendedAction: 'Reduce commitment size for the coming week rather than repeating the same plan.',
      evidence: { window: '7d', followThrough: metrics.followThrough7 },
    });
  }

  // --- Outstanding check-ins --------------------------------------------
  if (metrics.overdueCheckins >= 3) {
    alerts.push({
      alertType: 'missed_checkins',
      alertKey: 'missed_checkins',
      severity: 'medium',
      title: `${metrics.overdueCheckins} check-ins outstanding`,
      description:
        `${metrics.overdueCheckins} commitments have passed their date without a check-in, so recent ` +
        'follow-through is measured on less data than usual.',
      recommendedAction: 'A short nudge usually recovers these; consider asking what is making check-in hard.',
      evidence: { overdueCheckins: metrics.overdueCheckins },
    });
  }

  // --- Disengagement ------------------------------------------------------
  if (metrics.daysSinceLastActivity !== null && metrics.daysSinceLastActivity >= 7) {
    alerts.push({
      alertType: 'inactivity',
      alertKey: 'inactivity',
      severity: metrics.daysSinceLastActivity >= 14 ? 'high' : 'medium',
      title: `No activity for ${metrics.daysSinceLastActivity} days`,
      description: 'Nothing has been recorded recently, so there is no current signal to read.',
      recommendedAction: 'Reach out directly. Disengagement usually shows up here before it shows up on a call.',
      evidence: { daysSinceLastActivity: metrics.daysSinceLastActivity },
    });
  }

  // --- Exercise completion ------------------------------------------------
  if (metrics.exerciseCompletion30 !== null && metrics.exerciseCompletion30 < 0.5) {
    alerts.push({
      alertType: 'exercise_completion_decline',
      alertKey: 'exercise_completion_decline',
      severity: 'low',
      title: `Exercise completion at ${formatRate(metrics.exerciseCompletion30)}`,
      description: 'Fewer reflections are being completed, which reduces what Nell can see.',
      recommendedAction: 'Check whether the current exercise still fits how this client actually works.',
      evidence: { exerciseCompletion30: metrics.exerciseCompletion30 },
    });
  }

  // --- Newly detected patterns worth raising ------------------------------
  for (const pattern of patterns) {
    if (pattern.confidence < 0.6) continue;
    if (pattern.patternType === 'strength') continue;
    alerts.push({
      alertType: 'pattern_detected',
      alertKey: `pattern:${pattern.patternKey}`,
      severity: pattern.confidence >= 0.8 ? 'medium' : 'low',
      title: pattern.title,
      description: pattern.description,
      recommendedAction:
        pattern.suggestedQuestion ?? 'Worth raising on the next call to see whether it matches their experience.',
      evidence: pattern.evidence as unknown as Record<string, unknown>,
    });
  }

  // --- Experiments that ended without improvement -------------------------
  for (const experiment of input.experiments ?? []) {
    if (experiment.status !== 'completed') continue;
    if (experiment.result_metric === null || experiment.baseline_metric === null) continue;
    if (experiment.result_metric >= experiment.baseline_metric) continue;
    alerts.push({
      alertType: 'experiment_no_improvement',
      alertKey: `experiment:${experiment.id}`,
      severity: 'low',
      title: `Experiment "${experiment.title}" did not improve follow-through`,
      description:
        `Follow-through moved from ${formatRate(experiment.baseline_metric)} to ` +
        `${formatRate(experiment.result_metric)} over the experiment window.`,
      recommendedAction: 'Worth designing a different intervention rather than extending this one.',
      evidence: {
        baseline: experiment.baseline_metric,
        result: experiment.result_metric,
        experimentId: experiment.id,
      },
    });
  }

  return alerts.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

