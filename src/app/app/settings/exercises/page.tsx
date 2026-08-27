import type { Metadata } from 'next';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { ExerciseStep } from '@/components/onboarding/steps';
import { EmptyState } from '@/components/shared/metric-display';
import { requireOwner } from '@/lib/auth/session';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { Exercise } from '@/lib/types';

export const metadata: Metadata = { title: 'Exercises' };
export const dynamic = 'force-dynamic';

export default async function ExercisesSettingsPage() {
  await requireOwner();
  const supabase = await createSupabaseServerClient();

  const { data: exercises } = await supabase
    .from('exercises')
    .select('*')
    .order('created_at', { ascending: false });

  const rows = (exercises ?? []) as Exercise[];

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Exercises</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          An exercise is your framework in use. New exercises are assigned to every current client.
        </p>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No exercises yet"
          description="Without an exercise, clients have nothing to open when they sign in."
        />
      ) : (
        <div className="space-y-3">
          {rows.map((exercise) => (
            <Card key={exercise.id}>
              <CardContent className="flex flex-wrap items-start justify-between gap-3 p-4">
                <div>
                  <p className="font-medium">{exercise.name}</p>
                  {exercise.description ? (
                    <p className="mt-1 text-sm text-muted-foreground">{exercise.description}</p>
                  ) : null}
                  {exercise.prompts_commitment ? (
                    <p className="mt-1 text-xs text-muted-foreground">Ends with a commitment</p>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="muted">{exercise.frequency}</Badge>
                  <Badge variant={exercise.active ? 'stable' : 'muted'}>
                    {exercise.active ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div>
        <h3 className="font-semibold">Add an exercise</h3>
        <div className="mt-4">
          <ExerciseStep redirectTo="/app/settings/exercises" />
        </div>
      </div>
    </div>
  );
}
