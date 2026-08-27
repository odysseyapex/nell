import 'server-only';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { type ClientMetrics, computeClientMetrics, todayIn } from '@/lib/metrics';
import { addDays } from '@/lib/metrics/dates';
import { type PatternCandidate, detectPatterns } from '@/lib/patterns/engine';
import { type RiskAssessment, assessRisk } from '@/lib/risk';
import { type AlertCandidate, generateAlerts } from '@/lib/alerts/engine';
import { displayName } from '@/lib/format';
import type {
  CoachAlert,
  CoachingBrief,
  CommitmentFact,
  Experiment,
  ExerciseEntry,
  Pattern,
  Profile,
} from '@/lib/types';

/**
 * The read side of Nellvia's intelligence.
 *
 * Every query here runs through the RLS-bound server client, so a coach
 * querying a client they are not assigned to gets an empty result rather than
 * an error — there is no way to probe for the existence of another tenant's
 * data. The maths is then done in memory by the pure functions in lib/metrics,
 * lib/patterns and lib/risk.
 */

export interface ClientIntelligence {
  client: Profile;
  metrics: ClientMetrics;
  patterns: PatternCandidate[];
  storedPatterns: Pattern[];
  alerts: AlertCandidate[];
  openAlerts: CoachAlert[];
  risk: RiskAssessment;
  experiments: Experiment[];
  latestBrief: CoachingBrief | null;
  facts: CommitmentFact[];
  referenceDate: string;
}

const HISTORY_DAYS = 180;

export async function getCommitmentFacts(
  clientIds: string[],
  referenceDate: string,
): Promise<Map<string, CommitmentFact[]>> {
  const grouped = new Map<string, CommitmentFact[]>();
  for (const id of clientIds) grouped.set(id, []);
  if (clientIds.length === 0) return grouped;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('commitment_facts')
    .select('*')
    .in('client_id', clientIds)
    .gte('commitment_date', addDays(referenceDate, -HISTORY_DAYS))
    .order('commitment_date', { ascending: false });

  if (error) {
    console.error('[intelligence] failed to read commitment facts', error.message);
    return grouped;
  }

  for (const row of (data ?? []) as CommitmentFact[]) {
    grouped.get(row.client_id)?.push(row);
  }
  return grouped;
}

async function getExerciseEntries(
  clientIds: string[],
  referenceDate: string,
): Promise<Map<string, ExerciseEntry[]>> {
  const grouped = new Map<string, ExerciseEntry[]>();
  for (const id of clientIds) grouped.set(id, []);
  if (clientIds.length === 0) return grouped;

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from('exercise_entries')
    .select('*')
    .in('client_id', clientIds)
    .gte('entry_date', addDays(referenceDate, -HISTORY_DAYS));

  for (const row of (data ?? []) as ExerciseEntry[]) {
    grouped.get(row.client_id)?.push(row);
  }
  return grouped;
}

/** Most recent moment of any client-generated activity. */
function lastActivityFrom(facts: CommitmentFact[], entries: ExerciseEntry[]): string | null {
  const stamps: string[] = [];
  for (const fact of facts) {
    stamps.push(fact.created_at);
    if (fact.checked_in_at) stamps.push(fact.checked_in_at);
  }
  for (const entry of entries) {
    stamps.push(entry.completed_at ?? entry.started_at);
  }
  if (stamps.length === 0) return null;
  return stamps.reduce((latest, stamp) => (stamp > latest ? stamp : latest));
}

export async function getClientIntelligence(
  clientId: string,
  timezone: string,
): Promise<ClientIntelligence | null> {
  const supabase = await createSupabaseServerClient();
  const referenceDate = todayIn(timezone);

  const { data: client } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', clientId)
    .maybeSingle<Profile>();

  // RLS returns nothing rather than an error when access is denied, so a null
  // here means "not yours" and "does not exist" alike — which is what we want.
  if (!client) return null;

  const [factsByClient, entriesByClient, patternsResult, alertsResult, experimentsResult, briefResult] =
    await Promise.all([
      getCommitmentFacts([clientId], referenceDate),
      getExerciseEntries([clientId], referenceDate),
      supabase
        .from('patterns')
        .select('*')
        .eq('client_id', clientId)
        .in('status', ['candidate', 'active'])
        .order('confidence_score', { ascending: false }),
      supabase
        .from('coach_alerts')
        .select('*')
        .eq('client_id', clientId)
        .is('resolved_at', null)
        .order('created_at', { ascending: false }),
      supabase
        .from('experiments')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false }),
      supabase
        .from('coaching_briefs')
        .select('*')
        .eq('client_id', clientId)
        .order('generated_at', { ascending: false })
        .limit(1)
        .maybeSingle<CoachingBrief>(),
    ]);

  const facts = factsByClient.get(clientId) ?? [];
  const entries = entriesByClient.get(clientId) ?? [];
  const experiments = (experimentsResult.data ?? []) as Experiment[];
  const openAlerts = (alertsResult.data ?? []) as CoachAlert[];
  const storedPatterns = (patternsResult.data ?? []) as Pattern[];

  const metrics = computeClientMetrics({
    facts,
    referenceDate,
    exerciseEntries: entries,
    lastActivityAt: lastActivityFrom(facts, entries),
  });

  const patterns = detectPatterns(facts, { referenceDate });
  const alerts = generateAlerts({ metrics, patterns, experiments });

  const risk = assessRisk({
    metrics,
    openHighSeverityAlerts: openAlerts.filter((a) => a.severity === 'high').length,
    activePatterns: storedPatterns.filter((p) => p.status === 'active').length,
    failedExperiments: experiments.filter(
      (e) =>
        e.status === 'completed' &&
        e.result_metric !== null &&
        e.baseline_metric !== null &&
        e.result_metric < e.baseline_metric,
    ).length,
  });

  return {
    client,
    metrics,
    patterns,
    storedPatterns,
    alerts,
    openAlerts,
    risk,
    experiments,
    latestBrief: briefResult.data ?? null,
    facts,
    referenceDate,
  };
}

export interface RosterEntry {
  client: Profile;
  coachName: string | null;
  metrics: ClientMetrics;
  risk: RiskAssessment;
  headline: AlertCandidate | null;
  openAlertCount: number;
  activeExperiment: Experiment | null;
  lastActivityAt: string | null;
}

/**
 * The coach dashboard in a single pass.
 *
 * Reads every accessible client's history at once and computes the roster in
 * memory, rather than issuing per-client queries. RLS already narrows the rows
 * to clients this coach may see, so the visible set needs no extra filtering.
 */
export async function getRoster(timezone: string): Promise<RosterEntry[]> {
  const supabase = await createSupabaseServerClient();
  const referenceDate = todayIn(timezone);

  const { data: clients } = await supabase
    .from('profiles')
    .select('*')
    .eq('role', 'client')
    .in('status', ['active', 'invited'])
    .order('first_name');

  const clientRows = (clients ?? []) as Profile[];
  if (clientRows.length === 0) return [];

  const clientIds = clientRows.map((c) => c.id);

  const [factsByClient, entriesByClient, assignments, alerts, patterns, experiments, coaches] =
    await Promise.all([
      getCommitmentFacts(clientIds, referenceDate),
      getExerciseEntries(clientIds, referenceDate),
      supabase.from('coach_client_assignments').select('coach_id, client_id').in('client_id', clientIds),
      supabase
        .from('coach_alerts')
        .select('*')
        .in('client_id', clientIds)
        .is('resolved_at', null),
      supabase.from('patterns').select('client_id, status').in('client_id', clientIds),
      supabase.from('experiments').select('*').in('client_id', clientIds),
      supabase.from('profiles').select('id, first_name, last_name, email').in('role', ['coach', 'organization_owner']),
    ]);

  const coachNames = new Map<string, string>();
  for (const coach of (coaches.data ?? []) as Profile[]) {
    coachNames.set(coach.id, displayName(coach));
  }

  const coachByClient = new Map<string, string>();
  for (const row of (assignments.data ?? []) as { coach_id: string; client_id: string }[]) {
    coachByClient.set(row.client_id, row.coach_id);
  }

  const alertsByClient = new Map<string, CoachAlert[]>();
  for (const alert of (alerts.data ?? []) as CoachAlert[]) {
    alertsByClient.set(alert.client_id, [...(alertsByClient.get(alert.client_id) ?? []), alert]);
  }

  const activePatternCount = new Map<string, number>();
  for (const row of (patterns.data ?? []) as { client_id: string; status: string }[]) {
    if (row.status !== 'active') continue;
    activePatternCount.set(row.client_id, (activePatternCount.get(row.client_id) ?? 0) + 1);
  }

  const experimentsByClient = new Map<string, Experiment[]>();
  for (const experiment of (experiments.data ?? []) as Experiment[]) {
    experimentsByClient.set(experiment.client_id, [
      ...(experimentsByClient.get(experiment.client_id) ?? []),
      experiment,
    ]);
  }

  return clientRows.map((client) => {
    const facts = factsByClient.get(client.id) ?? [];
    const entries = entriesByClient.get(client.id) ?? [];
    const clientExperiments = experimentsByClient.get(client.id) ?? [];
    const clientAlerts = alertsByClient.get(client.id) ?? [];
    const lastActivityAt = lastActivityFrom(facts, entries);

    const metrics = computeClientMetrics({
      facts,
      referenceDate,
      exerciseEntries: entries,
      lastActivityAt,
    });

    const detected = detectPatterns(facts, { referenceDate });
    const generated = generateAlerts({ metrics, patterns: detected, experiments: clientExperiments });

    const risk = assessRisk({
      metrics,
      openHighSeverityAlerts: clientAlerts.filter((a) => a.severity === 'high').length,
      activePatterns: activePatternCount.get(client.id) ?? 0,
      failedExperiments: clientExperiments.filter(
        (e) =>
          e.status === 'completed' &&
          e.result_metric !== null &&
          e.baseline_metric !== null &&
          e.result_metric < e.baseline_metric,
      ).length,
    });

    const coachId = coachByClient.get(client.id);

    return {
      client,
      coachName: coachId ? (coachNames.get(coachId) ?? null) : null,
      metrics,
      risk,
      headline: generated[0] ?? null,
      openAlertCount: clientAlerts.length,
      activeExperiment: clientExperiments.find((e) => e.status === 'active') ?? null,
      lastActivityAt,
    };
  });
}
