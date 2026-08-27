import 'server-only';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { todayIn } from '@/lib/metrics/dates';
import type {
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
 * Every query is scoped by RLS to the signed-in client. Nothing here reads
 * coach-private material — alerts, risk snapshots, briefs and notes have no
 * client-side policy at all, so they cannot leak through this path even by
 * mistake.
 */

export interface TodayView {
  today: string;
  exercises: (Exercise & { entryId: string | null; entryStatus: string | null })[];
  dueCheckins: Commitment[];
  upcoming: Commitment[];
  activeExperiment: Experiment | null;
  reasonCodes: ReasonCode[];
}

export async function getTodayView(clientId: string, timezone: string): Promise<TodayView> {
  const supabase = await createSupabaseServerClient();
  const today = todayIn(timezone);

  const [assignments, entries, commitments, experiments, reasons] = await Promise.all([
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
    supabase.from('experiments').select('*').eq('client_id', clientId).eq('status', 'active').limit(1),
    supabase.from('reason_codes').select('*').eq('active', true).order('sort_order'),
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

  return {
    today,
    exercises,
    // A commitment is due for check-in once its day has arrived or passed.
    dueCheckins: planned.filter((c) => c.commitment_date <= today),
    upcoming: planned.filter((c) => c.commitment_date > today),
    activeExperiment: ((experiments.data ?? []) as Experiment[])[0] ?? null,
    reasonCodes: (reasons.data ?? []) as ReasonCode[],
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
