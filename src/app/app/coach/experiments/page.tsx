import Link from 'next/link';
import type { Metadata } from 'next';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { CompleteExperimentButton } from '@/components/coach/client-actions';
import { EmptyState } from '@/components/shared/metric-display';
import { requireStaff } from '@/lib/auth/session';
import { displayName } from '@/lib/format';
import { formatRate } from '@/lib/metrics';
import { todayIn } from '@/lib/metrics/dates';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { Experiment, Profile } from '@/lib/types';

export const metadata: Metadata = { title: 'Experiments' };
export const dynamic = 'force-dynamic';

/**
 * Every experiment across the coach's roster.
 *
 * This is the screen that answers "did anything I tried actually work?" — the
 * question a coach can rarely answer from memory, and the reason Nell records
 * a baseline at the moment an experiment starts rather than reconstructing one
 * afterwards.
 */
export default async function ExperimentsPage() {
  const { organization } = await requireStaff();
  const supabase = await createSupabaseServerClient();
  const today = todayIn(organization.timezone);

  const [{ data: experiments }, { data: clients }] = await Promise.all([
    supabase.from('experiments').select('*').order('start_date', { ascending: false }),
    supabase.from('profiles').select('*').eq('role', 'client'),
  ]);

  const clientById = new Map(((clients ?? []) as Profile[]).map((client) => [client.id, client]));
  const rows = (experiments ?? []) as Experiment[];

  const active = rows.filter((experiment) => experiment.status === 'active');
  const completed = rows.filter((experiment) => experiment.status === 'completed');
  const other = rows.filter(
    (experiment) => experiment.status !== 'active' && experiment.status !== 'completed',
  );

  const measured = completed.filter(
    (experiment) => experiment.result_metric !== null && experiment.baseline_metric !== null,
  );
  const improved = measured.filter(
    (experiment) => (experiment.result_metric ?? 0) > (experiment.baseline_metric ?? 0),
  );

  function ExperimentCard({ experiment }: { experiment: Experiment }) {
    const client = clientById.get(experiment.client_id);
    const delta =
      experiment.result_metric !== null && experiment.baseline_metric !== null
        ? experiment.result_metric - experiment.baseline_metric
        : null;
    const overdue = experiment.status === 'active' && experiment.end_date !== null && experiment.end_date < today;

    return (
      <Card>
        <CardContent className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold">{experiment.title}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {client ? (
                  <Link href={`/app/coach/clients/${client.id}`} className="hover:underline">
                    {displayName(client)}
                  </Link>
                ) : (
                  'Unknown client'
                )}
                {' · '}
                {experiment.start_date} → {experiment.end_date ?? 'open'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {overdue ? <Badge variant="watch">Ready to close</Badge> : null}
              <Badge
                variant={
                  experiment.status === 'active'
                    ? 'watch'
                    : experiment.status === 'completed'
                      ? 'stable'
                      : 'muted'
                }
              >
                {experiment.status}
              </Badge>
            </div>
          </div>

          <p className="mt-3 text-sm text-muted-foreground">{experiment.intervention}</p>

          <div className="mt-4 flex flex-wrap items-end gap-6">
            <div>
              <p className="metric-label">Baseline</p>
              <p className="mt-1 text-lg font-semibold tabular">
                {formatRate(experiment.baseline_metric)}
              </p>
            </div>
            <div>
              <p className="metric-label">Result</p>
              <p className="mt-1 text-lg font-semibold tabular">
                {formatRate(experiment.result_metric)}
              </p>
            </div>
            {delta !== null ? (
              <div>
                <p className="metric-label">Change</p>
                <p
                  className={`mt-1 text-lg font-semibold tabular ${
                    delta > 0
                      ? 'text-[hsl(var(--signal-stable))]'
                      : delta < 0
                        ? 'text-[hsl(var(--signal-attention))]'
                        : ''
                  }`}
                >
                  {delta > 0 ? '+' : ''}
                  {Math.round(delta * 100)} pts
                </p>
              </div>
            ) : null}
            {experiment.status === 'active' ? (
              <div className="ml-auto">
                <CompleteExperimentButton experimentId={experiment.id} />
              </div>
            ) : null}
          </div>

          {experiment.result_summary ? (
            <p className="mt-4 text-sm text-muted-foreground">{experiment.result_summary}</p>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Experiments</h1>
        <p className="mt-1 text-muted-foreground">
          {measured.length === 0
            ? 'A baseline is recorded when an experiment starts, and the same metric is measured when it closes.'
            : `${improved.length} of ${measured.length} completed experiments improved follow-through.`}
        </p>
      </header>

      {rows.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            title="No experiments yet"
            description="Open a client, find a pattern, and turn it into something testable. Nell records the baseline and measures the result."
          />
        </div>
      ) : (
        <div className="mt-8 space-y-8">
          {active.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-lg font-semibold tracking-tight">Running</h2>
              {active.map((experiment) => (
                <ExperimentCard key={experiment.id} experiment={experiment} />
              ))}
            </section>
          ) : null}

          {completed.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-lg font-semibold tracking-tight">Completed</h2>
              {completed.map((experiment) => (
                <ExperimentCard key={experiment.id} experiment={experiment} />
              ))}
            </section>
          ) : null}

          {other.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-lg font-semibold tracking-tight">Drafts and cancelled</h2>
              {other.map((experiment) => (
                <ExperimentCard key={experiment.id} experiment={experiment} />
              ))}
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
