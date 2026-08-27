import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { ArrowRight, FlaskConical } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { CheckinCard } from '@/components/client/checkin-card';
import { startExercise } from '@/app/app/actions';
import { requireClient } from '@/lib/auth/session';
import { ensureClientPreferences, getTodayView } from '@/lib/data/client-view';
import { headlineInsight } from '@/lib/insights/client';

export const metadata: Metadata = { title: 'Today' };
export const dynamic = 'force-dynamic';

function greeting(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/**
 * Today.
 *
 * The one screen that has to work. It answers "what am I doing today, and
 * what do I owe an answer on?" and offers a single obvious action.
 *
 * There is deliberately no dashboard here: no percentage, no trend arrow, no
 * risk level. Someone opening this at 7am needs one thing to do, not an
 * assessment of themselves. The numbers live in Insights, where they come with
 * enough context to mean something.
 */
export default async function ClientTodayPage() {
  const { profile, organization } = await requireClient();
  const timezone = profile.timezone ?? organization.timezone;

  const preferences = await ensureClientPreferences(profile.id, organization.id, timezone);
  if (preferences && !preferences.onboarding_complete) redirect('/app/client/welcome');

  const view = await getTodayView(profile.id, timezone);
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', hour12: false }).format(
      new Date(),
    ),
  );

  const pendingExercises = view.exercises.filter((exercise) => exercise.entryStatus !== 'completed');
  const insight = headlineInsight(view.insights);
  const experiment = view.experiment;

  return (
    <div className="mx-auto max-w-2xl space-y-8 px-4 py-8 sm:px-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          {greeting(hour)}
          {profile.first_name ? `, ${profile.first_name}` : ''}
        </h1>
        <p className="mt-1 text-muted-foreground">
          {view.dueCheckins.length > 0
            ? `${view.dueCheckins.length === 1 ? 'One thing' : `${view.dueCheckins.length} things`} to close the loop on.`
            : 'Nothing outstanding. Whenever you are ready.'}
        </p>
      </header>

      {/* What you owe an answer on, first. */}
      {view.dueCheckins.length > 0 ? (
        <section className="space-y-4">
          {view.dueCheckins.map((commitment, index) => (
            <CheckinCard
              key={commitment.id}
              commitment={commitment}
              reasonCodes={view.reasonCodes}
              collapsible={index === 0 && view.dueCheckins.length === 1}
            />
          ))}
        </section>
      ) : null}

      {/* What you have already decided for today. */}
      {view.dueCheckins.length === 0 && view.todayCommitments.length > 0 ? (
        <section className="space-y-3">
          <h2 className="metric-label">Today&apos;s commitment</h2>
          {view.todayCommitments.map((commitment) => (
            <Card key={commitment.id}>
              <CardContent className="p-5">
                <p className="text-lg font-medium">{commitment.commitment_text}</p>
                {commitment.confidence_score !== null ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    How realistic it felt:{' '}
                    <span className="tabular">{commitment.confidence_score}%</span>
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </section>
      ) : null}

      {view.dueCheckins.length === 0 && view.todayCommitments.length === 0 ? (
        <Card>
          <CardContent className="p-5">
            <p className="font-medium">Nothing committed for today</p>
            <p className="mt-1 text-sm text-muted-foreground">
              One specific thing is enough. It does not have to be big.
            </p>
            <Button size="xl" className="mt-4 w-full" asChild>
              <Link href="/app/client/commitments">Make a commitment</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {pendingExercises.length > 0 ? (
        <section className="space-y-3">
          <h2 className="metric-label">Today&apos;s reflection</h2>
          {pendingExercises.map((exercise) => (
            <Card key={exercise.id}>
              <CardContent className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-lg font-medium">{exercise.name}</p>
                    {exercise.description ? (
                      <p className="mt-1 text-sm text-muted-foreground">{exercise.description}</p>
                    ) : null}
                  </div>
                  {exercise.entryStatus === 'started' ? (
                    <Badge variant="watch">In progress</Badge>
                  ) : null}
                </div>

                <form action={startExercise} className="mt-4">
                  <input type="hidden" name="exerciseId" value={exercise.id} />
                  <Button type="submit" size="lg" variant="outline" className="w-full">
                    {exercise.entryStatus === 'started' ? 'Continue' : 'Start'}{' '}
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </form>
              </CardContent>
            </Card>
          ))}
        </section>
      ) : null}

      {experiment ? (
        <section className="space-y-3">
          <h2 className="metric-label">What you are testing</h2>
          <Card>
            <CardContent className="p-5">
              <div className="flex items-start gap-3">
                <FlaskConical className="mt-1 h-5 w-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{experiment.experiment.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {experiment.experiment.intervention}
                  </p>
                  <div className="mt-4 space-y-1.5">
                    <Progress
                      value={(experiment.dayNumber / experiment.totalDays) * 100}
                      indicatorClassName="bg-[var(--brand)]"
                    />
                    <p className="text-xs text-muted-foreground tabular">
                      Day {experiment.dayNumber} of {experiment.totalDays}
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>
      ) : null}

      {/* Exactly one observation. Everything else is on the Insights tab. */}
      {insight ? (
        <section className="space-y-3">
          <h2 className="metric-label">Nellvia noticed</h2>
          <Card>
            <CardContent className="p-5">
              <p className="font-medium">{insight.title}</p>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{insight.summary}</p>
              <Link
                href="/app/client/insights"
                className="mt-4 inline-flex items-center gap-1 text-sm font-medium underline underline-offset-4"
              >
                See what else <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </CardContent>
          </Card>
        </section>
      ) : null}
    </div>
  );
}
