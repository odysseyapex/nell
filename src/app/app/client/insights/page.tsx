import Link from 'next/link';
import type { Metadata } from 'next';
import { FlaskConical } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { EmptyState } from '@/components/shared/metric-display';
import { requireClient } from '@/lib/auth/session';
import { getClientExperiments, getClientFacts } from '@/lib/data/client-view';
import { type InsightStage, buildClientInsights } from '@/lib/insights/client';
import { formatRate, todayIn } from '@/lib/metrics';
import { addDays } from '@/lib/metrics/dates';

export const metadata: Metadata = { title: 'Insights' };
export const dynamic = 'force-dynamic';

const STAGE_NOTE: Record<InsightStage, string> = {
  first_days:
    'You have only just started, so for now this is a count. After about a week there is usually enough to see something.',
  early_patterns:
    'Early days. Anything below is a first signal rather than a settled pattern, and it may change.',
  context:
    'There is enough here to see what tends to be going on around the commitments that do not go to plan.',
  behaviour_model:
    'A month in, this is a description of the conditions that have worked for you so far. It is not a rule about who you are.',
};

/**
 * Insights.
 *
 * The payoff screen. Not a chart wall: a small number of things Nellvia has
 * noticed, each with the counts behind it and something concrete to try.
 *
 * What is absent matters as much as what is here. No score, no grade, no
 * comparison against other people, no streak. If the record is too thin to say
 * anything, this page says so rather than filling the space.
 */
export default async function ClientInsightsPage() {
  const { profile, organization } = await requireClient();
  const timezone = profile.timezone ?? organization.timezone;
  const referenceDate = todayIn(timezone);

  const [facts, experiments] = await Promise.all([
    getClientFacts(profile.id, addDays(referenceDate, -180)),
    getClientExperiments(profile.id, timezone),
  ]);

  const result = buildClientInsights(facts, { referenceDate });
  const active = experiments.find((item) => item.experiment.status === 'active');
  const finished = experiments.filter((item) => item.experiment.status === 'completed');

  return (
    <div className="mx-auto max-w-2xl space-y-8 px-4 py-8 sm:px-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">What Nellvia noticed</h1>
        <p className="mt-2 text-muted-foreground">{STAGE_NOTE[result.stage]}</p>
      </header>

      {active ? (
        <section className="space-y-3">
          <h2 className="metric-label">This week&apos;s experiment</h2>
          <Card className="border-[var(--brand)]">
            <CardContent className="space-y-4 p-5">
              <div className="flex items-start gap-3">
                <FlaskConical className="mt-1 h-5 w-5 shrink-0 text-[var(--brand)]" />
                <div className="min-w-0">
                  <p className="text-lg font-medium">{active.experiment.title}</p>
                </div>
              </div>

              <div>
                <p className="metric-label">The idea</p>
                <p className="mt-1 text-sm">{active.experiment.hypothesis}</p>
              </div>

              <div>
                <p className="metric-label">What you are trying</p>
                <p className="mt-1 text-sm">{active.experiment.intervention}</p>
              </div>

              <div className="space-y-1.5">
                <Progress
                  value={(active.dayNumber / active.totalDays) * 100}
                  indicatorClassName="bg-[var(--brand)]"
                />
                <p className="text-xs text-muted-foreground tabular">
                  Day {active.dayNumber} of {active.totalDays}
                </p>
              </div>
            </CardContent>
          </Card>
        </section>
      ) : null}

      {result.cards.length === 0 ? (
        <EmptyState
          title="Nothing to report yet"
          description="Nellvia waits until there is enough recorded to say something worth reading. Keep going. A week of check-ins is usually the point where it can start."
        />
      ) : (
        <section className="space-y-4">
          {result.cards.map((card) => (
            <Card key={card.key}>
              <CardContent className="space-y-4 p-5 sm:p-6">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-lg font-medium">{card.title}</p>
                    {card.provisional ? <Badge variant="muted">early signal</Badge> : null}
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{card.summary}</p>
                </div>

                {card.evidence.length > 0 ? (
                  <div className="evidence">
                    <p className="metric-label mb-2">What this is based on</p>
                    <ul className="space-y-1">
                      {card.evidence.map((line) => (
                        <li key={line} className="tabular">
                          · {line}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {card.suggestion ? (
                  <div className="rounded-lg border border-[var(--brand)] bg-[var(--brand-soft)] px-4 py-3">
                    <p className="metric-label">Try this next</p>
                    <p className="mt-1 font-medium">{card.suggestion}</p>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </section>
      )}

      {finished.length > 0 ? (
        <section className="space-y-3">
          <h2 className="metric-label">What you have already tested</h2>
          {finished.map(({ experiment }) => {
            const moved =
              experiment.result_metric !== null && experiment.baseline_metric !== null
                ? experiment.result_metric - experiment.baseline_metric
                : null;

            return (
              <Card key={experiment.id}>
                <CardContent className="p-5">
                  <p className="font-medium">{experiment.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{experiment.intervention}</p>
                  {moved !== null ? (
                    <p className="mt-3 text-sm">
                      Follow-through went from{' '}
                      <span className="tabular">{formatRate(experiment.baseline_metric)}</span> to{' '}
                      <span className="tabular font-medium">{formatRate(experiment.result_metric)}</span>
                      {moved > 0.02
                        ? '. Worth keeping.'
                        : moved < -0.02
                          ? '. That one did not help, which is still useful to know.'
                          : '. About the same either way.'}
                    </p>
                  ) : (
                    <p className="mt-3 text-sm text-muted-foreground">
                      Not enough recorded during the test to compare.
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </section>
      ) : null}

      <p className="pt-2 text-center text-sm">
        <Link href="/app/client/history" className="text-muted-foreground underline underline-offset-4">
          See everything you have recorded
        </Link>
      </p>
    </div>
  );
}
