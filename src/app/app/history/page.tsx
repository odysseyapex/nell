import type { Metadata } from 'next';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/shared/metric-display';
import { requireClient } from '@/lib/auth/session';
import { getClientFacts } from '@/lib/data/client-view';
import { todayIn } from '@/lib/metrics';
import { addDays } from '@/lib/metrics/dates';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { Exercise, ExerciseEntry, ExerciseResponse, FrameworkStep } from '@/lib/types';

export const metadata: Metadata = { title: 'History' };
export const dynamic = 'force-dynamic';

interface DayGroup {
  date: string;
  commitments: Awaited<ReturnType<typeof getClientFacts>>;
  reflections: {
    id: string;
    exerciseName: string;
    answers: { title: string; value: string }[];
  }[];
}

function formatAnswer(response: ExerciseResponse): string {
  if (response.response_text) return response.response_text;
  if (response.response_number !== null) return String(response.response_number);
  const json = response.response_json as { choices?: string[] } | null;
  if (json?.choices?.length) return json.choices.join(', ');
  return '—';
}

/**
 * The client's own record.
 *
 * This is the screen that makes Nell feel like it belongs to the client rather
 * than to their coach: their words, in their order, kept where they can read
 * them back.
 */
export default async function HistoryPage() {
  const { profile, organization } = await requireClient();
  const timezone = profile.timezone ?? organization.timezone;
  const referenceDate = todayIn(timezone);
  const since = addDays(referenceDate, -90);

  const supabase = await createSupabaseServerClient();
  const [facts, { data: entries }, { data: exercises }, { data: steps }, { data: responses }] =
    await Promise.all([
      getClientFacts(profile.id, since),
      supabase
        .from('exercise_entries')
        .select('*')
        .eq('client_id', profile.id)
        .eq('status', 'completed')
        .gte('entry_date', since)
        .order('entry_date', { ascending: false }),
      supabase.from('exercises').select('*'),
      supabase.from('framework_steps').select('*').order('step_order'),
      supabase.from('exercise_responses').select('*'),
    ]);

  const exerciseById = new Map(((exercises ?? []) as Exercise[]).map((e) => [e.id, e]));
  const stepById = new Map(((steps ?? []) as FrameworkStep[]).map((s) => [s.id, s]));

  const responsesByEntry = new Map<string, ExerciseResponse[]>();
  for (const response of (responses ?? []) as ExerciseResponse[]) {
    responsesByEntry.set(response.entry_id, [
      ...(responsesByEntry.get(response.entry_id) ?? []),
      response,
    ]);
  }

  const days = new Map<string, DayGroup>();
  const dayFor = (date: string): DayGroup => {
    const existing = days.get(date);
    if (existing) return existing;
    const created: DayGroup = { date, commitments: [], reflections: [] };
    days.set(date, created);
    return created;
  };

  for (const fact of facts) dayFor(fact.commitment_date).commitments.push(fact);

  for (const entry of (entries ?? []) as ExerciseEntry[]) {
    const answers = (responsesByEntry.get(entry.id) ?? [])
      .map((response) => ({
        step: stepById.get(response.framework_step_id),
        value: formatAnswer(response),
      }))
      .filter((row) => row.step)
      .sort((a, b) => (a.step!.step_order ?? 0) - (b.step!.step_order ?? 0))
      .map((row) => ({ title: row.step!.title, value: row.value }));

    dayFor(entry.entry_date).reflections.push({
      id: entry.id,
      exerciseName: exerciseById.get(entry.exercise_id)?.name ?? 'Reflection',
      answers,
    });
  }

  const ordered = [...days.values()].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-8 sm:px-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">History</h1>
        <p className="mt-1 text-muted-foreground">Everything you have recorded, most recent first.</p>
      </header>

      {ordered.length === 0 ? (
        <EmptyState
          title="Nothing here yet"
          description="Your reflections and commitments will build up here as you go."
        />
      ) : (
        ordered.map((day) => (
          <section key={day.date} className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              {day.date}
            </h2>

            {day.commitments.map((fact) => (
              <Card key={fact.commitment_id}>
                <CardContent className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <p className="font-medium">{fact.commitment_text}</p>
                    <Badge
                      variant={
                        fact.status === 'completed'
                          ? 'stable'
                          : fact.status === 'missed'
                            ? 'attention'
                            : fact.status === 'changed'
                              ? 'watch'
                              : 'muted'
                      }
                    >
                      {fact.status}
                    </Badge>
                  </div>
                  {fact.reason_name ? (
                    <p className="mt-1 text-sm text-muted-foreground">
                      What influenced it: {fact.reason_name}
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            ))}

            {day.reflections.map((reflection) => (
              <Card key={reflection.id}>
                <CardContent className="p-4">
                  <p className="metric-label">{reflection.exerciseName}</p>
                  <dl className="mt-3 space-y-3">
                    {reflection.answers.map((answer) => (
                      <div key={answer.title}>
                        <dt className="text-sm font-medium">{answer.title}</dt>
                        <dd className="mt-0.5 whitespace-pre-wrap text-sm text-muted-foreground">
                          {answer.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </CardContent>
              </Card>
            ))}
          </section>
        ))
      )}
    </div>
  );
}
