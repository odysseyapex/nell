import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  EmptyState,
  EvidenceList,
  MetricCard,
  RiskBadge,
  TrendLabel,
} from '@/components/shared/metric-display';
import {
  CoachNoteForm,
  CompleteExperimentButton,
  GenerateBriefButton,
  PatternStatusButtons,
  ResolveAlertButton,
  StartExperimentDialog,
} from '@/components/coach/client-actions';
import { BreakdownChart, FollowThroughTrendChart } from '@/components/coach/follow-through-chart';
import { requireStaff } from '@/lib/auth/session';
import { getClientIntelligence } from '@/lib/data/intelligence';
import { followThroughOf, formatRate, inWindow, lastNDays } from '@/lib/metrics';
import { addDays } from '@/lib/metrics/dates';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { CoachNote, CommitmentFact, Profile } from '@/lib/types';
import { displayName } from '@/lib/format';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { organization } = await requireStaff();
  const { id } = await params;
  const intelligence = await getClientIntelligence(id, organization.timezone);
  const name = intelligence
    ? `${intelligence.client.first_name} ${intelligence.client.last_name}`.trim()
    : 'Client';
  return { title: name || 'Client' };
}

/** Weekly follow-through for the trend chart, computed from the same facts. */
function weeklySeries(facts: CommitmentFact[], referenceDate: string, weeks = 12) {
  return Array.from({ length: weeks }, (_, index) => {
    const end = addDays(referenceDate, -7 * (weeks - 1 - index));
    const window = lastNDays(end, 7);
    const followThrough = followThroughOf(inWindow(facts, window));
    return {
      label: end.slice(5),
      rate: followThrough.rate,
      eligible: followThrough.eligible,
    };
  });
}

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { organization } = await requireStaff();
  const { id } = await params;

  const intelligence = await getClientIntelligence(id, organization.timezone);
  // RLS returns nothing for a client this coach may not see, which is the same
  // as a client that does not exist — and should look the same from outside.
  if (!intelligence) notFound();

  const { client, metrics, patterns, storedPatterns, openAlerts, risk, experiments, latestBrief, facts } =
    intelligence;

  const supabase = await createSupabaseServerClient();
  const [{ data: notes }, { data: coachRow }] = await Promise.all([
    supabase
      .from('coach_notes')
      .select('*')
      .eq('client_id', client.id)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('coach_client_assignments')
      .select('coach:profiles!coach_client_assignments_coach_id_fkey(first_name, last_name)')
      .eq('client_id', client.id)
      .maybeSingle(),
  ]);

  const name = displayName(client);
  const activeExperiment = experiments.find((e) => e.status === 'active') ?? null;
  const coach = (coachRow as { coach?: Pick<Profile, 'first_name' | 'last_name'> } | null)?.coach;

  const recent = [...facts]
    .sort((a, b) => b.commitment_date.localeCompare(a.commitment_date))
    .slice(0, 40);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{name}</h1>
            <RiskBadge level={risk.level} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {client.email}
            {coach ? ` · Coach: ${`${coach.first_name} ${coach.last_name}`.trim()}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <GenerateBriefButton clientId={client.id} />
          <StartExperimentDialog clientId={client.id} />
        </div>
      </header>

      {/* Why this client is flagged — always visible, never behind a tab. */}
      {risk.reasons.length > 0 ? (
        <Card className="mt-6 border-l-4" style={{ borderLeftColor: 'var(--brand)' }}>
          <CardContent className="p-5">
            <p className="metric-label">Why Nell flagged this</p>
            <ul className="mt-2 space-y-1 text-sm">
              {risk.reasons.map((reason) => (
                <li key={reason.code}>· {reason.label}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Tabs defaultValue="overview" className="mt-8">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="commitments">Commitments</TabsTrigger>
          <TabsTrigger value="patterns">Patterns</TabsTrigger>
          <TabsTrigger value="experiments">Experiments</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="notes">Coach notes</TabsTrigger>
        </TabsList>

        {/* ------------------------------------------------------------- */}
        <TabsContent value="overview" className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="7-day follow-through"
              value={formatRate(metrics.followThrough7.rate)}
              detail={`${metrics.followThrough7.completed} of ${metrics.followThrough7.eligible} completed`}
            />
            <MetricCard
              label="30-day follow-through"
              value={formatRate(metrics.followThrough30.rate)}
              detail={`${metrics.followThrough30.completed} of ${metrics.followThrough30.eligible} completed`}
              trend={metrics.trend}
            />
            <MetricCard
              label="90-day follow-through"
              value={formatRate(metrics.followThrough90.rate)}
              detail={`${metrics.followThrough90.eligible} resolved commitments`}
            />
            <MetricCard
              label="Exercise completion"
              value={formatRate(metrics.exerciseCompletion30)}
              detail="Last 30 days"
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Follow-through, week by week</CardTitle>
              </CardHeader>
              <CardContent>
                <FollowThroughTrendChart data={weeklySeries(facts, intelligence.referenceDate)} />
                <div className="mt-4">
                  <TrendLabel trend={metrics.trend} delta={metrics.trendDelta} />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Confidence calibration</CardTitle>
              </CardHeader>
              <CardContent>
                {metrics.calibration.sampleSize === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No commitments with a confidence rating have resolved yet.
                  </p>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <p className="metric-label">Average predicted</p>
                      <p className="metric-value">{formatRate(metrics.calibration.predicted)}</p>
                    </div>
                    <div>
                      <p className="metric-label">Actual follow-through</p>
                      <p className="metric-value">{formatRate(metrics.calibration.actual)}</p>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Across {metrics.calibration.sampleSize} commitments.{' '}
                      {metrics.calibration.gap !== null && metrics.calibration.gap >= 0.15
                        ? 'Plans may be consistently more ambitious than they appear when they are created.'
                        : metrics.calibration.gap !== null && metrics.calibration.gap <= -0.15
                          ? 'Outcomes are running ahead of predictions — there may be room for more ambition.'
                          : 'Predictions are tracking outcomes closely.'}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Most recorded reasons</CardTitle>
              </CardHeader>
              <CardContent>
                {metrics.topReasons.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nothing recorded yet against commitments that did not go to plan.
                  </p>
                ) : (
                  <ul className="space-y-3">
                    {metrics.topReasons.slice(0, 6).map((reason) => (
                      <li key={reason.slug} className="flex items-center justify-between gap-4">
                        <span>{reason.name}</span>
                        <span className="text-sm text-muted-foreground tabular">
                          {reason.count} · {formatRate(reason.share)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>By day of week</CardTitle>
              </CardHeader>
              <CardContent>
                <BreakdownChart
                  data={metrics.byWeekday.map((bucket) => ({
                    label: bucket.label.slice(0, 3),
                    rate: bucket.followThrough.rate,
                    eligible: bucket.followThrough.eligible,
                  }))}
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  Faded bars have fewer than three resolved commitments.
                </p>
              </CardContent>
            </Card>
          </div>

          {latestBrief ? (
            <Card>
              <CardHeader>
                <CardTitle>Latest coaching brief</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="font-medium">{latestBrief.headline}</p>
                <p className="text-sm leading-relaxed text-muted-foreground">{latestBrief.summary}</p>
                {latestBrief.suggested_questions_json.length > 0 ? (
                  <div>
                    <p className="metric-label">Suggested questions</p>
                    <ul className="mt-2 space-y-1 text-sm">
                      {latestBrief.suggested_questions_json.map((question) => (
                        <li key={question}>· {question}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  Generated {new Date(latestBrief.generated_at).toLocaleString()} for{' '}
                  {latestBrief.period_start} → {latestBrief.period_end}
                </p>
              </CardContent>
            </Card>
          ) : null}

          {openAlerts.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Open alerts</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {openAlerts.map((alert) => (
                  <div key={alert.id} className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{alert.title}</p>
                        <Badge
                          variant={
                            alert.severity === 'high'
                              ? 'attention'
                              : alert.severity === 'medium'
                                ? 'watch'
                                : 'muted'
                          }
                        >
                          {alert.severity}
                        </Badge>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{alert.description}</p>
                      {alert.recommended_action ? (
                        <p className="mt-1 text-sm">{alert.recommended_action}</p>
                      ) : null}
                    </div>
                    <ResolveAlertButton alertId={alert.id} />
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </TabsContent>

        {/* ------------------------------------------------------------- */}
        <TabsContent value="commitments">
          <Card>
            <CardHeader>
              <CardTitle>Recent commitments</CardTitle>
            </CardHeader>
            <CardContent>
              {recent.length === 0 ? (
                <EmptyState
                  title="No commitments yet"
                  description="Commitments appear here as soon as this client starts recording them."
                />
              ) : (
                <ul className="divide-y divide-border">
                  {recent.map((item) => (
                    <li key={item.commitment_id} className="py-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium">{item.commitment_text}</p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {item.commitment_date}
                            {item.confidence_score !== null
                              ? ` · predicted confidence ${item.confidence_score}%`
                              : ''}
                            {item.reason_name ? ` · ${item.reason_name}` : ''}
                          </p>
                        </div>
                        <Badge
                          variant={
                            item.status === 'completed'
                              ? 'stable'
                              : item.status === 'missed'
                                ? 'attention'
                                : item.status === 'changed'
                                  ? 'watch'
                                  : 'muted'
                          }
                        >
                          {item.status}
                        </Badge>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ------------------------------------------------------------- */}
        <TabsContent value="patterns" className="space-y-4">
          {patterns.length === 0 ? (
            <EmptyState
              title="No patterns detected yet"
              description="Nell only reports a pattern once there is enough data behind it. Roughly two weeks of check-ins is usually the point where rules start to fire."
            />
          ) : (
            patterns.map((pattern) => {
              const stored = storedPatterns.find((p) => p.pattern_key === pattern.patternKey);
              return (
                <Card key={pattern.patternKey}>
                  <CardContent className="p-6">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold">{pattern.title}</p>
                        {/*
                          The rule engine's own description is shown when there
                          is no stored AI wording, so a pattern always reads
                          properly whether or not OpenAI is configured.
                        */}
                        <p className="mt-1 text-sm text-muted-foreground">
                          {stored?.ai_explanation ?? pattern.description}
                        </p>
                      </div>
                      <Badge variant="muted">
                        confidence {Math.round(pattern.confidence * 100)}%
                      </Badge>
                    </div>

                    <div className="mt-4">
                      <EvidenceList statements={pattern.evidence.statements} />
                    </div>

                    {pattern.suggestedQuestion ? (
                      <div className="mt-4">
                        <p className="metric-label">Suggested coaching question</p>
                        <p className="mt-1">{pattern.suggestedQuestion}</p>
                      </div>
                    ) : null}

                    <Separator className="my-4" />

                    <div className="flex flex-wrap items-center justify-between gap-3">
                      {stored ? (
                        <PatternStatusButtons patternId={stored.id} status={stored.status} />
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          Detected live from current data. It is stored the next time the nightly job runs.
                        </p>
                      )}
                      {pattern.suggestedExperiment ? (
                        <StartExperimentDialog
                          clientId={client.id}
                          patternId={stored?.id}
                          suggestedTitle={pattern.title}
                          suggestedHypothesis={pattern.description}
                          suggestedIntervention={pattern.suggestedExperiment}
                          triggerLabel="Test this"
                          variant="outline"
                        />
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </TabsContent>

        {/* ------------------------------------------------------------- */}
        <TabsContent value="experiments" className="space-y-4">
          {activeExperiment ? null : (
            <p className="text-sm text-muted-foreground">
              No experiment is running. Turning a pattern into a test is how you find out whether it
              is actionable.
            </p>
          )}

          {experiments.length === 0 ? (
            <EmptyState
              title="No experiments yet"
              description="An experiment records a baseline now, applies one change, and measures the same metric afterwards."
              action={<StartExperimentDialog clientId={client.id} />}
            />
          ) : (
            experiments.map((experiment) => (
              <Card key={experiment.id}>
                <CardContent className="p-6">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">{experiment.title}</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {experiment.start_date} → {experiment.end_date ?? 'open'}
                      </p>
                    </div>
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

                  <dl className="mt-4 grid gap-4 sm:grid-cols-2">
                    <div>
                      <dt className="metric-label">Hypothesis</dt>
                      <dd className="mt-1 text-sm">{experiment.hypothesis}</dd>
                    </div>
                    <div>
                      <dt className="metric-label">Intervention</dt>
                      <dd className="mt-1 text-sm">{experiment.intervention}</dd>
                    </div>
                    <div>
                      <dt className="metric-label">Baseline</dt>
                      <dd className="mt-1 text-sm tabular">{formatRate(experiment.baseline_metric)}</dd>
                    </div>
                    <div>
                      <dt className="metric-label">Result</dt>
                      <dd className="mt-1 text-sm tabular">{formatRate(experiment.result_metric)}</dd>
                    </div>
                  </dl>

                  {experiment.result_summary ? (
                    <p className="mt-4 text-sm text-muted-foreground">{experiment.result_summary}</p>
                  ) : null}

                  {experiment.status === 'active' ? (
                    <div className="mt-4">
                      <CompleteExperimentButton experimentId={experiment.id} />
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        {/* ------------------------------------------------------------- */}
        <TabsContent value="history">
          <Card>
            <CardHeader>
              <CardTitle>Time of day a commitment was made</CardTitle>
            </CardHeader>
            <CardContent>
              <BreakdownChart
                data={metrics.byTimeOfDay.map((bucket) => ({
                  label: bucket.label,
                  rate: bucket.followThrough.rate,
                  eligible: bucket.followThrough.eligible,
                }))}
              />
              <p className="mt-4 text-sm text-muted-foreground">
                {metrics.commitmentsCreated30} commitments created in the last 30 days —
                about {metrics.commitmentCreationRatePerWeek} a week.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ------------------------------------------------------------- */}
        <TabsContent value="notes" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Add a note</CardTitle>
            </CardHeader>
            <CardContent>
              <CoachNoteForm clientId={client.id} />
            </CardContent>
          </Card>

          {((notes ?? []) as CoachNote[]).length === 0 ? (
            <EmptyState title="No notes yet" description="Notes are private to your coaching team." />
          ) : (
            <div className="space-y-3">
              {((notes ?? []) as CoachNote[]).map((note) => (
                <Card key={note.id}>
                  <CardContent className="p-5">
                    <p className="whitespace-pre-wrap text-sm">{note.body}</p>
                    <p className="mt-3 text-xs text-muted-foreground">
                      {new Date(note.created_at).toLocaleString()}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
