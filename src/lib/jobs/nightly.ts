import 'server-only';

import { generateAlerts } from '@/lib/alerts/engine';
import { isAiConfigured } from '@/lib/ai/client';
import { explainPattern } from '@/lib/ai/insight';
import { computeClientMetrics } from '@/lib/metrics';
import { addDays, todayIn } from '@/lib/metrics/dates';
import { detectPatterns } from '@/lib/patterns/engine';
import { assessRisk } from '@/lib/risk';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type {
  CoachAlert,
  OrganizationAiSettings,
  CommitmentFact,
  Experiment,
  ExerciseEntry,
  Organization,
  Pattern,
  Profile,
} from '@/lib/types';

/**
 * The nightly intelligence pass.
 *
 * Detection itself is cheap and already runs live on every page load — this
 * job exists to give findings *continuity*: a pattern needs a stable identity
 * so a coach can dismiss it, an alert needs to persist so it can be marked
 * handled, and the roster needs a snapshot so "what changed since yesterday"
 * is answerable at all.
 *
 * It runs with the service role because it acts for the platform rather than
 * for any signed-in person. Every query is therefore explicitly scoped to one
 * organization at a time.
 */

export interface NightlyResult {
  organizations: number;
  clients: number;
  patternsUpserted: number;
  alertsOpened: number;
  alertsAutoResolved: number;
  snapshots: number;
  errors: string[];
}

const HISTORY_DAYS = 180;

export async function runNightlyIntelligence(): Promise<NightlyResult> {
  const admin = createSupabaseAdminClient();
  const result: NightlyResult = {
    organizations: 0,
    clients: 0,
    patternsUpserted: 0,
    alertsOpened: 0,
    alertsAutoResolved: 0,
    snapshots: 0,
    errors: [],
  };

  const { data: organizations, error } = await admin
    .from('organizations')
    .select('*')
    .in('status', ['active', 'paused']);

  if (error) {
    result.errors.push(`organizations: ${error.message}`);
    return result;
  }

  for (const organization of (organizations ?? []) as Organization[]) {
    try {
      await processOrganization(organization, result);
      result.organizations += 1;
    } catch (organizationError) {
      const message =
        organizationError instanceof Error ? organizationError.message : 'unknown error';
      result.errors.push(`${organization.slug}: ${message}`);
    }
  }

  return result;
}

async function processOrganization(organization: Organization, result: NightlyResult) {
  const admin = createSupabaseAdminClient();
  const referenceDate = todayIn(organization.timezone);
  const since = addDays(referenceDate, -HISTORY_DAYS);

  const { data: clients } = await admin
    .from('profiles')
    .select('*')
    .eq('organization_id', organization.id)
    .eq('role', 'client')
    .in('status', ['active', 'invited']);

  const clientRows = (clients ?? []) as Profile[];
  if (clientRows.length === 0) return;

  const clientIds = clientRows.map((client) => client.id);

  // Fetched once per organization: every pattern explanation for this run uses
  // the same coach voice, and the row does not change mid-pass.
  const { data: aiSettings } = await admin
    .from('organization_ai_settings')
    .select('*')
    .eq('organization_id', organization.id)
    .maybeSingle<OrganizationAiSettings>();

  const [factsResult, entriesResult, experimentsResult, alertsResult, patternsResult] =
    await Promise.all([
      admin
        .from('commitment_facts')
        .select('*')
        .eq('organization_id', organization.id)
        .gte('commitment_date', since),
      admin
        .from('exercise_entries')
        .select('*')
        .eq('organization_id', organization.id)
        .gte('entry_date', since),
      admin.from('experiments').select('*').eq('organization_id', organization.id),
      admin
        .from('coach_alerts')
        .select('*')
        .eq('organization_id', organization.id)
        .is('resolved_at', null),
      admin
        .from('patterns')
        .select('*')
        .eq('organization_id', organization.id)
        .in('client_id', clientIds),
    ]);

  const factsByClient = groupBy((factsResult.data ?? []) as CommitmentFact[], (row) => row.client_id);
  const entriesByClient = groupBy((entriesResult.data ?? []) as ExerciseEntry[], (row) => row.client_id);
  const experimentsByClient = groupBy((experimentsResult.data ?? []) as Experiment[], (row) => row.client_id);
  const openAlertsByClient = groupBy((alertsResult.data ?? []) as CoachAlert[], (row) => row.client_id);
  const storedPatterns = (patternsResult.data ?? []) as Pattern[];

  const now = new Date().toISOString();

  for (const client of clientRows) {
    const facts = factsByClient.get(client.id) ?? [];
    const entries = entriesByClient.get(client.id) ?? [];
    const experiments = experimentsByClient.get(client.id) ?? [];
    const openAlerts = openAlertsByClient.get(client.id) ?? [];

    const metrics = computeClientMetrics({
      facts,
      referenceDate,
      exerciseEntries: entries,
      lastActivityAt: lastActivity(facts, entries),
    });

    const detected = detectPatterns(facts, { referenceDate });

    // ---- patterns ---------------------------------------------------------
    for (const candidate of detected) {
      const existing = storedPatterns.find(
        (pattern) => pattern.client_id === client.id && pattern.pattern_key === candidate.patternKey,
      );

      // A coach's dismissal is a judgement about their client. Re-detecting the
      // same key must not silently resurrect it.
      if (existing?.status === 'dismissed') continue;

      // AI wording is generated once, when a pattern first appears, and then
      // stored. Re-writing every pattern every night would multiply the model
      // bill by the number of clients for no benefit — the underlying finding
      // has not changed.
      let explanation: string | null = existing?.ai_explanation ?? null;
      if (!existing && isAiConfigured()) {
        try {
          const insight = await explainPattern(candidate, {
            organizationId: organization.id,
            clientFirstName: client.first_name || 'This client',
            aiSettings,
          });
          explanation = insight.summary;
        } catch (error) {
          // The rule engine's own wording is already coach-ready, so a model
          // failure costs polish, not the finding.
          console.error('[nightly] pattern explanation failed', error);
        }
      }

      const { error: upsertError } = await admin.from('patterns').upsert(
        {
          ai_explanation: explanation,
          ...(existing ? { id: existing.id } : {}),
          organization_id: organization.id,
          client_id: client.id,
          pattern_type: candidate.patternType,
          pattern_key: candidate.patternKey,
          title: candidate.title,
          description: candidate.description,
          confidence_score: candidate.confidence,
          evidence_json: candidate.evidence,
          suggested_question: candidate.suggestedQuestion,
          suggested_experiment: candidate.suggestedExperiment,
          last_detected_at: now,
          ...(existing ? {} : { first_detected_at: now, status: 'candidate' }),
        },
        { onConflict: 'client_id,pattern_key' },
      );

      if (!upsertError) result.patternsUpserted += 1;
    }

    // A pattern that no longer fires is resolved, not deleted: the coach may
    // well want to know it went away, and when.
    const detectedKeys = new Set(detected.map((candidate) => candidate.patternKey));
    const stale = storedPatterns.filter(
      (pattern) =>
        pattern.client_id === client.id &&
        !detectedKeys.has(pattern.pattern_key) &&
        (pattern.status === 'candidate' || pattern.status === 'active'),
    );
    if (stale.length > 0) {
      await admin
        .from('patterns')
        .update({ status: 'resolved' })
        .in(
          'id',
          stale.map((pattern) => pattern.id),
        );
    }

    // ---- alerts -----------------------------------------------------------
    const generated = generateAlerts({ metrics, patterns: detected, experiments });
    const generatedKeys = new Set(generated.map((alert) => alert.alertKey));

    for (const alert of generated) {
      // Stable keys mean a condition that persists stays one alert rather than
      // becoming a nightly drumbeat.
      if (openAlerts.some((open) => open.alert_key === alert.alertKey)) continue;

      const { error: insertError } = await admin.from('coach_alerts').insert({
        organization_id: organization.id,
        client_id: client.id,
        alert_type: alert.alertType,
        alert_key: alert.alertKey,
        severity: alert.severity,
        title: alert.title,
        description: alert.description,
        recommended_action: alert.recommendedAction,
        evidence_json: alert.evidence,
      });

      if (!insertError) result.alertsOpened += 1;
    }

    // Conditions that have cleared close themselves, so the coach's list stays
    // a list of things that are true now.
    const cleared = openAlerts.filter((alert) => !generatedKeys.has(alert.alert_key));
    if (cleared.length > 0) {
      await admin
        .from('coach_alerts')
        .update({ resolved_at: now })
        .in(
          'id',
          cleared.map((alert) => alert.id),
        );
      result.alertsAutoResolved += cleared.length;
    }

    // ---- risk snapshot ----------------------------------------------------
    const risk = assessRisk({
      metrics,
      openHighSeverityAlerts: generated.filter((alert) => alert.severity === 'high').length,
      activePatterns: detected.length,
      failedExperiments: experiments.filter(
        (experiment) =>
          experiment.status === 'completed' &&
          experiment.result_metric !== null &&
          experiment.baseline_metric !== null &&
          experiment.result_metric < experiment.baseline_metric,
      ).length,
    });

    const { error: snapshotError } = await admin.from('client_status_snapshots').upsert(
      {
        organization_id: organization.id,
        client_id: client.id,
        as_of: referenceDate,
        risk_level: risk.level,
        risk_reasons_json: risk.reasons.map((reason) => reason.label),
        follow_through_7: metrics.followThrough7.rate,
        follow_through_30: metrics.followThrough30.rate,
        follow_through_90: metrics.followThrough90.rate,
        follow_through_prev_30: metrics.followThroughPrev30.rate,
        trend: metrics.trend,
        confidence_avg: metrics.confidenceAverage,
        calibration_gap: metrics.calibration.gap,
        exercise_completion_30: metrics.exerciseCompletion30,
        open_commitments: metrics.openCommitments,
        overdue_checkins: metrics.overdueCheckins,
        days_since_activity: metrics.daysSinceLastActivity,
        metrics_json: {
          topReasons: metrics.topReasons.slice(0, 5),
          riskScore: risk.score,
        },
      },
      { onConflict: 'client_id,as_of' },
    );

    if (!snapshotError) result.snapshots += 1;
    result.clients += 1;
  }
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const id = key(row);
    map.set(id, [...(map.get(id) ?? []), row]);
  }
  return map;
}

function lastActivity(facts: CommitmentFact[], entries: ExerciseEntry[]): string | null {
  const stamps: string[] = [];
  for (const fact of facts) {
    stamps.push(fact.created_at);
    if (fact.checked_in_at) stamps.push(fact.checked_in_at);
  }
  for (const entry of entries) stamps.push(entry.completed_at ?? entry.started_at);
  if (stamps.length === 0) return null;
  return stamps.reduce((latest, stamp) => (stamp > latest ? stamp : latest));
}
