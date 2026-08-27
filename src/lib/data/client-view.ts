import 'server-only';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { type ClientInsightResult, buildClientInsights } from '@/lib/insights/client';
import { computeClientMetrics, todayIn } from '@/lib/metrics';
import { addDays, daysBetweenDates } from '@/lib/metrics/dates';
import type {
  ClientPreferences,
  Commitment,
  CommitmentFact,
  Exercise,
  ExerciseEntry,
  Experiment,
  ReasonCode,
} from '@/lib/types';

/**
 * Reads for the client's own screens.
 *
 * Every query is scoped by RLS to the signed-in client. Nothing here touches
 * coach-private material — alerts, risk snapshots, briefs and notes have no
 * client-side policy at all, so it cannot leak through this path even by
 * mistake. That is deliberate: the client app has to feel like a tool for
 * understanding yourself, not a window onto how you are being assessed.
 */

const HISTORY_DAYS = 180;

/** An experiment as the client sees it: what we are testing, and how far in. */
export interface ExperimentProgress {
  experiment: Experiment;
  dayNumber: number;
  totalDays: number;
  complete: boolean;
}

export interface TodayView {
  today: string;
  exercises: (Exercise & { entryId: string | null; entryStatus: string | null })[];
  dueCheckins: Commitment[];
  todayCommitments: Commitment[];
  upcoming: Commitment[];
  experiment: ExperimentProgress | null;
  reasonCodes: ReasonCode[];
  insights: ClientInsightResult;
  preferences: ClientPreferences | null;
}

function progressFor(experiment: Experiment, today: string): ExperimentProgress {
  const totalDays = experiment.end_date
    ? Math.max(1, daysBetweenDates(experiment.start_date, experiment.end_date))
    : experiment.baseline_window_days;
  const elapsed = daysBetweenDates(experiment.start_date, today) + 1;

  return {
    experiment,
    dayNumber: Math.min(Math.max(elapsed, 1), totalDays),
    totalDays,
    complete: elapsed > totalDays,
  };
}

export async function getTodayView(clientId: string, timezone: string): Promise<TodayView> {
  const supabase = await createSupabaseServerClient();
  const today = todayIn(timezone);

  const [assignments, entries, commitments, experiments, reasons, preferences, factRows] =
    await Promise.all([
      supabase
        .from('exercise_assignments')
        .select('exercise:exercises(*)')
        .eq('client_id', clientId)
        .eq('active', true),
      supabase.from('exercise_entries').select('*').eq('client_id', clientId).eq('entry_date', today),
      supabase
        .from('commitments')
        .select('*')
        .eq('client_id', clientId)
        .eq('status', 'planned')
        .order('commitment_date', { ascending: true }),
      supabase
        .from('experiments')
        .select('*')
        .eq('client_id', clientId)
        .eq('status', 'active')
        .order('start_date', { ascending: false })
        .limit(1),
      supabase.from('reason_codes').select('*').eq('active', true).order('sort_order'),
      supabase
        .from('client_preferences')
        .select('*')
        .eq('client_id', clientId)
        .maybeSingle<ClientPreferences>(),
      supabase
        .from('commitment_facts')
        .select('*')
        .eq('client_id', clientId)
        .gte('commitment_date', addDays(today, -HISTORY_DAYS)),
    ]);

  const todaysEntries = (entries.data ?? []) as ExerciseEntry[];

  // Supabase types an embedded relation as an array; the foreign key makes it
  // at most one row, so it is narrowed here rather than at every use site.
  const exercises = ((assignments.data ?? []) as unknown as { exercise: Exercise | null }[])
    .map((row) => row.exercise)
    .filter((exercise): exercise is Exercise => Boolean(exercise) && exercise!.active)
    .map((exercise) => {
      const entry = todaysEntries.find((e) => e.exercise_id === exercise.id);
      return { ...exercise, entryId: entry?.id ?? null, entryStatus: entry?.status ?? null };
    });

  const planned = (commitments.data ?? []) as Commitment[];
  const facts = (factRows.data ?? []) as CommitmentFact[];
  const activeExperiment = ((experiments.data ?? []) as Experiment[])[0] ?? null;

  return {
    today,
    exercises,
    // Due once the day has arrived or passed — a commitment for today can be
    // checked in from the moment the day starts.
    dueCheckins: planned.filter((c) => c.commitment_date <= today),
    todayCommitments: planned.filter((c) => c.commitment_date === today),
    upcoming: planned.filter((c) => c.commitment_date > today),
    experiment: activeExperiment ? progressFor(activeExperiment, today) : null,
    reasonCodes: (reasons.data ?? []) as ReasonCode[],
    insights: buildClientInsights(facts, {
      referenceDate: today,
      metrics: computeClientMetrics({ facts, referenceDate: today }),
    }),
    preferences: preferences.data ?? null,
  };
}

export async function getClientFacts(clientId: string, sinceDate: string): Promise<CommitmentFact[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from('commitment_facts')
    .select('*')
    .eq('client_id', clientId)
    .gte('commitment_date', sinceDate)
    .order('commitment_date', { ascending: false });

  return (data ?? []) as CommitmentFact[];
}

/** Every experiment this client has been part of, newest first. */
export async function getClientExperiments(
  clientId: string,
  timezone: string,
): Promise<ExperimentProgress[]> {
  const supabase = await createSupabaseServerClient();
  const today = todayIn(timezone);

  const { data } = await supabase
    .from('experiments')
    .select('*')
    .eq('client_id', clientId)
    .in('status', ['active', 'completed'])
    .order('start_date', { ascending: false });

  return ((data ?? []) as Experiment[]).map((experiment) => progressFor(experiment, today));
}

/** Ensures a preferences row exists, so onboarding state has somewhere to live. */
export async function ensureClientPreferences(
  clientId: string,
  organizationId: string,
  timezone: string,
): Promise<ClientPreferences | null> {
  const supabase = await createSupabaseServerClient();

  const { data: existing } = await supabase
    .from('client_preferences')
    .select('*')
    .eq('client_id', clientId)
    .maybeSingle<ClientPreferences>();

  if (existing) return existing;

  const { data } = await supabase
    .from('client_preferences')
    .insert({ organization_id: organizationId, client_id: clientId, timezone })
    .select('*')
    .maybeSingle<ClientPreferences>();

  return data ?? null;
}
