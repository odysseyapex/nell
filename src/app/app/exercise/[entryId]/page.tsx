import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { ExerciseRunner } from '@/components/client/exercise-runner';
import { requireClient } from '@/lib/auth/session';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { addDays, todayIn } from '@/lib/metrics/dates';
import type { Exercise, ExerciseEntry, ExerciseResponse, FrameworkStep } from '@/lib/types';

export const metadata: Metadata = { title: 'Reflection' };
export const dynamic = 'force-dynamic';

export default async function ExercisePage({ params }: { params: Promise<{ entryId: string }> }) {
  const { profile, organization } = await requireClient();
  const { entryId } = await params;

  const supabase = await createSupabaseServerClient();

  // RLS scopes entries to the signed-in client, so another client's entry id
  // simply returns nothing here.
  const { data: entry } = await supabase
    .from('exercise_entries')
    .select('*')
    .eq('id', entryId)
    .maybeSingle<ExerciseEntry>();

  if (!entry) notFound();

  const { data: exercise } = await supabase
    .from('exercises')
    .select('*')
    .eq('id', entry.exercise_id)
    .maybeSingle<Exercise>();

  if (!exercise) notFound();

  const [{ data: steps }, { data: existing }] = await Promise.all([
    supabase
      .from('framework_steps')
      .select('*')
      .eq('framework_id', exercise.framework_id)
      .order('step_order'),
    supabase.from('exercise_responses').select('*').eq('entry_id', entry.id),
  ]);

  const timezone = profile.timezone ?? organization.timezone;
  const today = todayIn(timezone);

  return (
    <ExerciseRunner
      entryId={entry.id}
      exerciseName={exercise.name}
      exerciseDescription={exercise.description}
      promptsCommitment={exercise.prompts_commitment}
      completed={entry.status === 'completed'}
      steps={(steps ?? []) as FrameworkStep[]}
      existingResponses={(existing ?? []) as ExerciseResponse[]}
      today={today}
      tomorrow={addDays(today, 1)}
    />
  );
}
