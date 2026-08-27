import { describe, expect, it } from 'vitest';

import { generateAlerts } from '@/lib/alerts/engine';
import { computeClientMetrics } from '@/lib/metrics';
import { detectPatterns } from '@/lib/patterns/engine';
import { assessRisk } from '@/lib/risk';
import { fact, series } from './factories';

const referenceDate = '2026-08-30';

function metricsFor(facts: Parameters<typeof computeClientMetrics>[0]['facts'], extra = {}) {
  return computeClientMetrics({ facts, referenceDate, ...extra });
}

describe('assessRisk', () => {
  it('leaves a steady, engaged client alone', () => {
    const metrics = metricsFor([
      ...series('2026-07-02', 30, ['completed', 'completed', 'completed', 'missed']),
      ...series('2026-08-01', 29, ['completed', 'completed', 'completed', 'missed']),
    ], { lastActivityAt: '2026-08-30T09:00:00.000Z' });

    const risk = assessRisk({ metrics });
    expect(risk.level).toBe('stable');
    expect(risk.score).toBeLessThan(2);
  });

  it('escalates a client whose follow-through has fallen sharply', () => {
    const metrics = metricsFor([
      ...series('2026-07-02', 30, ['completed', 'completed', 'completed', 'missed']),
      ...series('2026-08-01', 29, ['missed', 'missed', 'missed', 'completed']),
    ], { lastActivityAt: '2026-08-29T09:00:00.000Z' });

    const risk = assessRisk({ metrics });
    expect(risk.level).toBe('needs_attention');
    expect(risk.reasons.some((r) => r.code === 'follow_through_decline')).toBe(true);
  });

  it('escalates on silence even with no bad outcomes recorded', () => {
    const metrics = metricsFor([], { lastActivityAt: '2026-08-10T09:00:00.000Z' });
    const risk = assessRisk({ metrics });
    expect(risk.reasons.some((r) => r.code === 'inactive')).toBe(true);
    expect(risk.score).toBeGreaterThanOrEqual(3);
  });

  it('always explains itself — no bare score', () => {
    const metrics = metricsFor([
      ...series('2026-08-01', 20, ['missed', 'missed', 'missed', 'completed']),
    ], { lastActivityAt: '2026-08-20T09:00:00.000Z' });
    const risk = assessRisk({ metrics });
    expect(risk.reasons.length).toBeGreaterThan(0);
    for (const reason of risk.reasons) {
      expect(reason.label.length).toBeGreaterThan(10);
      expect(reason.weight).toBeGreaterThan(0);
    }
    // Reasons are ordered by weight so the coach reads the biggest factor first.
    const weights = risk.reasons.map((r) => r.weight);
    expect([...weights].sort((a, b) => b - a)).toEqual(weights);
  });

  it('counts unresolved alerts and stacked patterns towards attention', () => {
    const metrics = metricsFor(series('2026-08-01', 12, ['completed', 'completed', 'missed']), {
      lastActivityAt: '2026-08-30T09:00:00.000Z',
    });
    const base = assessRisk({ metrics });
    const escalated = assessRisk({ metrics, openHighSeverityAlerts: 1, activePatterns: 2 });
    expect(escalated.score).toBe(base.score + 3);
  });
});

describe('generateAlerts', () => {
  it('leads with the highest severity alert', () => {
    const facts = [
      ...series('2026-07-02', 30, ['completed', 'completed', 'completed', 'missed']),
      ...series('2026-08-01', 29, ['missed', 'missed', 'missed', 'completed']),
    ];
    const metrics = metricsFor(facts, { lastActivityAt: '2026-08-29T09:00:00.000Z' });
    const alerts = generateAlerts({
      metrics,
      patterns: detectPatterns(facts, { referenceDate }),
    });

    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts[0].severity).toBe('high');
    for (const alert of alerts) {
      expect(alert.recommendedAction.length).toBeGreaterThan(10);
      expect(alert.alertKey).toBeTruthy();
    }
  });

  it('produces stable keys so a persisting condition does not become a daily drumbeat', () => {
    const facts = series('2026-08-01', 20, ['missed', 'missed', 'completed']);
    const metrics = metricsFor(facts, { lastActivityAt: '2026-08-30T09:00:00.000Z' });
    const first = generateAlerts({ metrics, patterns: [] }).map((a) => a.alertKey);
    const second = generateAlerts({ metrics, patterns: [] }).map((a) => a.alertKey);
    expect(first).toEqual(second);
    expect(new Set(first).size).toBe(first.length);
  });

  it('raises an alert when an experiment ends without improvement', () => {
    const metrics = metricsFor([]);
    const alerts = generateAlerts({
      metrics,
      patterns: [],
      experiments: [
        {
          id: 'exp-1',
          title: 'Afternoon snack',
          status: 'completed',
          end_date: '2026-08-20',
          baseline_metric: 0.53,
          result_metric: 0.41,
        },
      ],
    });
    expect(alerts.some((a) => a.alertType === 'experiment_no_improvement')).toBe(true);
  });

  it('says nothing about a quiet, healthy client', () => {
    const metrics = metricsFor(series('2026-08-20', 10, ['completed']), {
      lastActivityAt: '2026-08-30T09:00:00.000Z',
    });
    const alerts = generateAlerts({ metrics, patterns: [] });
    expect(alerts.filter((a) => a.severity === 'high')).toEqual([]);
  });

  it('never raises an alert for a strength pattern', () => {
    // 17 of 20 completed = 85%, exactly at the strength threshold.
    const facts = series('2026-08-01', 20, ['completed', 'completed', 'completed', 'completed', 'completed', 'missed']);
    const metrics = metricsFor(facts, { lastActivityAt: '2026-08-30T09:00:00.000Z' });
    const patterns = detectPatterns(facts, { referenceDate });
    expect(patterns.some((p) => p.patternType === 'strength')).toBe(true);
    const alerts = generateAlerts({ metrics, patterns });
    expect(alerts.some((a) => a.alertKey === 'pattern:strength')).toBe(false);
  });
});
