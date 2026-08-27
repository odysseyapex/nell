/**
 * Client risk status.
 *
 * This is a transparent, additive score — not a model, and deliberately not
 * marketed as churn prediction. Every point it awards comes with the sentence
 * that explains it, and the coach always sees the sentences, never just the
 * label.
 */

import type { ClientMetrics } from '@/lib/metrics';
import { formatRate } from '@/lib/metrics';
import type { RiskLevel } from '@/lib/types';

export interface RiskReason {
  code: string;
  label: string;
  weight: number;
}

export interface RiskAssessment {
  level: RiskLevel;
  score: number;
  reasons: RiskReason[];
}

export interface RiskInput {
  metrics: ClientMetrics;
  openHighSeverityAlerts?: number;
  activePatterns?: number;
  failedExperiments?: number;
}

export const RISK_THRESHOLDS = { needsAttention: 4, watch: 2 } as const;

export function assessRisk(input: RiskInput): RiskAssessment {
  const { metrics } = input;
  const reasons: RiskReason[] = [];

  const add = (code: string, label: string, weight: number) => {
    reasons.push({ code, label, weight });
  };

  if (metrics.trend === 'declining' && metrics.trendDelta !== null && metrics.trendDelta <= -0.15) {
    add(
      'follow_through_decline',
      `Follow-through fell from ${formatRate(metrics.followThroughPrev30.rate)} to ${formatRate(
        metrics.followThrough30.rate,
      )} over the last 30 days`,
      3,
    );
  } else if (metrics.trend === 'declining') {
    add(
      'follow_through_softening',
      `Follow-through is drifting down (${formatRate(metrics.followThroughPrev30.rate)} → ${formatRate(
        metrics.followThrough30.rate,
      )})`,
      1,
    );
  }

  if (
    metrics.followThrough7.rate !== null &&
    metrics.followThrough7.eligible >= 3 &&
    metrics.followThrough7.rate < 0.5
  ) {
    add(
      'low_recent_follow_through',
      `Only ${metrics.followThrough7.completed} of ${metrics.followThrough7.eligible} commitments completed in the last 7 days`,
      2,
    );
  }

  if (metrics.overdueCheckins >= 3) {
    add(
      'overdue_checkins',
      `${metrics.overdueCheckins} commitments are past their date with no check-in`,
      2,
    );
  } else if (metrics.overdueCheckins > 0) {
    add('overdue_checkins_minor', `${metrics.overdueCheckins} check-in(s) outstanding`, 1);
  }

  const idle = metrics.daysSinceLastActivity;
  if (idle !== null && idle >= 7) {
    add('inactive', `No activity for ${idle} days`, 3);
  } else if (idle !== null && idle >= 4) {
    add('quiet', `No activity for ${idle} days`, 1);
  }

  if (metrics.exerciseCompletion30 !== null && metrics.exerciseCompletion30 < 0.5) {
    add(
      'exercise_completion',
      `Exercise completion at ${formatRate(metrics.exerciseCompletion30)} over 30 days`,
      1,
    );
  }

  if ((input.openHighSeverityAlerts ?? 0) > 0) {
    add('open_alerts', `${input.openHighSeverityAlerts} unresolved high-severity alert(s)`, 2);
  }

  if ((input.activePatterns ?? 0) >= 2) {
    add('multiple_patterns', `${input.activePatterns} active behavioural patterns`, 1);
  }

  if ((input.failedExperiments ?? 0) > 0) {
    add('experiment_no_effect', `${input.failedExperiments} experiment(s) ended without improvement`, 1);
  }

  const score = reasons.reduce((total, reason) => total + reason.weight, 0);
  const level: RiskLevel =
    score >= RISK_THRESHOLDS.needsAttention
      ? 'needs_attention'
      : score >= RISK_THRESHOLDS.watch
        ? 'watch'
        : 'stable';

  return { level, score, reasons: reasons.sort((a, b) => b.weight - a.weight) };
}

export const RISK_LABELS: Record<RiskLevel, string> = {
  stable: 'Stable',
  watch: 'Watch',
  needs_attention: 'Needs attention',
};

/** Ordering for the coach dashboard: the people who need attention come first. */
export const RISK_ORDER: Record<RiskLevel, number> = {
  needs_attention: 0,
  watch: 1,
  stable: 2,
};
