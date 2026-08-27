import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowRight, FlaskConical } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { CheckinCard } from '@/components/client/checkin-card';
import { CommitmentForm } from '@/components/client/commitment-form';
import { startExercise } from '@/app/app/actions';
import { requireClient } from '@/lib/auth/session';
import { getTodayView } from '@/lib/data/client-view';
import { addDays } from '@/lib/metrics/dates';

export const metadata: Metadata = { title: 'Today' };
export const dynamic = 'force-dynamic';

function greeting(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/**
 * The client's home screen.
 *
 * Ordered by what is owed rather than by what is pretty: outstanding check-ins
 * first, then today's reflection, then the chance to commit to something new.
 * There is no dashboard of statistics here — a client opening Nell at 7am
 * needs one action, not an analysis of themselves.
 */
export default async function TodayPage() {
  const { profile, organization } = await requireClient();
  const timezone = profile.timezone ?? organization.timezone;
  const view = await getTodayView(profile.id, timezone);

  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', hour12: false }).format(
      new Date(),
    ),
  );

  const pendingExercises = view.exercises.filter((exercise) => exercise.entryStatus !== 'completed');

  return (
    <div className="mx-auto max-w-2xl space-y-8 px-4 py-8 sm:px-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          {greeting(hour)}
          {profile.first_name ? `, ${profile.first_name}` : ''}.
        </h1>
        <p className="mt-1 text-muted-foreground">
          {view.dueCheckins.length > 0
            ? `${view.dueCheckins.length} thing${view.dueCheckins.length === 1 ? '' : 's'} to check in on.`
            : 'Nothing outstanding. Whenever you are ready.'}
        </p>
      </header>

      {view.dueCheckins.length > 0 ? (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold tracking-tight">Check in</h2>
          {view.dueCheckins.map((commitment) => (
            <CheckinCard key={commitment.id} commitment={commitment} reasonCodes={view.reasonCodes} />
          ))}
        </section>
      ) : null}

      {pendingExercises.length > 0 ? (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold tracking-tight">Today&apos;s reflection</h2>
          {pendingExercises.map((exercise) => (
            <Card key={exercise.id}>
              <CardContent className="p-5 sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-lg font-medium">{exercise.name}</p>
                    {exercise.description ? (
                      <p className="mt-1 text-sm text-muted-foreground">{exercise.description}</p>
                    ) : null}
                  </div>
                  {exercise.entryStatus === 'started' ? <Badge variant="watch">In progress</Badge> : null}
                </div>

                <form action={startExercise} className="mt-5">
                  <input type="hidden" name="exerciseId" value={exercise.id} />
                  <Button type="submit" size="lg" className="w-full">
                    {exercise.entryStatus === 'started' ? 'Continue' : 'Start'}{' '}
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </form>
              </CardContent>
            </Card>
          ))}
        </section>
      ) : view.exercises.length > 0 ? (
        <p className="rounded-lg bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
          Today&apos;s reflection is done. Nothing else is needed.
        </p>
      ) : null}

      <section className="space-y-4">
        <h2 className="text-lg font-semibold tracking-tight">Make a commitment</h2>
        <CommitmentForm today={view.today} tomorrow={addDays(view.today, 1)} />
      </section>

      {view.upcoming.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">Coming up</h2>
          {view.upcoming.slice(0, 5).map((commitment) => (
            <div key={commitment.id} className="surface flex items-center justify-between gap-4 p-4">
              <div className="min-w-0">
                <p className="truncate font-medium">{commitment.commitment_text}</p>
                <p className="text-sm text-muted-foreground">{commitment.commitment_date}</p>
              </div>
              {commitment.confidence_score !== null ? (
                <span className="shrink-0 text-sm text-muted-foreground tabular">
                  {commitment.confidence_score}%
                </span>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}

      {view.activeExperiment ? (
        <section>
          <h2 className="text-lg font-semibold tracking-tight">What you are testing</h2>
          <Card className="mt-3">
            <CardContent className="p-5">
              <div className="flex items-start gap-3">
                <FlaskConical className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                <div>
                  <p className="font-medium">{view.activeExperiment.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {view.activeExperiment.intervention}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Running until {view.activeExperiment.end_date ?? 'further notice'}.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>
      ) : null}

      <p className="pt-4 text-center text-sm">
        <Link href="/app/insights" className="text-muted-foreground underline underline-offset-4">
          See what Nell has noticed
        </Link>
      </p>
    </div>
  );
}
