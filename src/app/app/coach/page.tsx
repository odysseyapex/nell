import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowRight } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState, MetricCard, RiskBadge, TrendLabel } from '@/components/shared/metric-display';
import { requireStaff } from '@/lib/auth/session';
import { getRoster } from '@/lib/data/intelligence';
import { formatRate } from '@/lib/metrics';
import { RISK_ORDER } from '@/lib/risk';
import { displayName } from '@/lib/format';

export const metadata: Metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

/**
 * The coach dashboard.
 *
 * Ordered by one question: who needs me? Attention comes first and the
 * roster-wide numbers come second, because a coach opening Nellvia on a Monday
 * morning is deciding where to spend the next hour, not admiring aggregates.
 */
export default async function CoachDashboardPage() {
  const { organization, profile } = await requireStaff();
  const roster = await getRoster(organization.timezone);

  const needsAttention = roster
    .filter((entry) => entry.risk.level !== 'stable')
    .sort(
      (a, b) =>
        RISK_ORDER[a.risk.level] - RISK_ORDER[b.risk.level] ||
        b.risk.score - a.risk.score ||
        (a.metrics.followThrough7.rate ?? 1) - (b.metrics.followThrough7.rate ?? 1),
    );

  const rated = roster.filter((entry) => entry.metrics.followThrough30.rate !== null);
  const averageFollowThrough =
    rated.length > 0
      ? rated.reduce((sum, entry) => sum + (entry.metrics.followThrough30.rate ?? 0), 0) / rated.length
      : null;

  const activeExperiments = roster.filter((entry) => entry.activeExperiment).length;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Good morning{profile.first_name ? `, ${profile.first_name}` : ''}
          </h1>
          <p className="mt-1 text-muted-foreground">
            {needsAttention.length === 0
              ? 'Nothing is trending the wrong way across your roster today.'
              : `${needsAttention.length} client${needsAttention.length === 1 ? '' : 's'} may need your attention.`}
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/app/coach/clients">View all clients</Link>
        </Button>
      </header>

      <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Active clients" value={String(roster.length)} />
        <MetricCard
          label="Needs attention"
          value={String(needsAttention.filter((e) => e.risk.level === 'needs_attention').length)}
          detail={`${needsAttention.filter((e) => e.risk.level === 'watch').length} on watch`}
        />
        <MetricCard
          label="Average follow-through"
          value={formatRate(averageFollowThrough)}
          detail={rated.length > 0 ? `Across ${rated.length} clients, 30 days` : 'No resolved commitments yet'}
        />
        <MetricCard label="Active experiments" value={String(activeExperiments)} />
      </section>

      <section className="mt-10">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold tracking-tight">Needs attention</h2>
          <p className="text-sm text-muted-foreground">Ranked by what changed, not alphabetically</p>
        </div>

        <div className="mt-4 space-y-3">
          {needsAttention.length === 0 ? (
            <EmptyState
              title="No one needs chasing today"
              description={
                roster.length === 0
                  ? 'Once you invite clients and they start recording commitments, this is where Nellvia tells you who to look at first.'
                  : 'Every client is inside their normal range on follow-through, engagement and check-ins.'
              }
              action={
                roster.length === 0 ? (
                  <Button asChild>
                    <Link href="/app/coach/clients">Invite your first client</Link>
                  </Button>
                ) : null
              }
            />
          ) : (
            needsAttention.map((entry) => (
              <Card key={entry.client.id} className="transition-shadow hover:shadow-md">
                <CardContent className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/app/coach/clients/${entry.client.id}`}
                          className="text-base font-semibold hover:underline"
                        >
                          {displayName(entry.client)}
                        </Link>
                        <RiskBadge level={entry.risk.level} />
                        {entry.openAlertCount > 0 ? (
                          <Badge variant="muted">
                            {entry.openAlertCount} open alert{entry.openAlertCount === 1 ? '' : 's'}
                          </Badge>
                        ) : null}
                      </div>

                      {/* The single sentence a coach should be able to read in under ten seconds. */}
                      {entry.headline ? (
                        <>
                          <p className="mt-3 font-medium">{entry.headline.title}</p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {entry.headline.description}
                          </p>
                          <p className="mt-3 text-sm">
                            <span className="metric-label">Suggested</span>{' '}
                            <span className="text-muted-foreground">
                              {entry.headline.recommendedAction}
                            </span>
                          </p>
                        </>
                      ) : (
                        <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
                          {entry.risk.reasons.slice(0, 3).map((reason) => (
                            <li key={reason.code}>· {reason.label}</li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div className="flex shrink-0 items-start gap-6">
                      <div className="text-right">
                        <p className="metric-label">7-day</p>
                        <p className="text-xl font-semibold tabular">
                          {formatRate(entry.metrics.followThrough7.rate)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="metric-label">30-day</p>
                        <p className="text-xl font-semibold tabular">
                          {formatRate(entry.metrics.followThrough30.rate)}
                        </p>
                        <div className="mt-1">
                          <TrendLabel trend={entry.metrics.trend} delta={entry.metrics.trendDelta} />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
                    <p className="text-xs text-muted-foreground">
                      {entry.metrics.daysSinceLastActivity === null
                        ? 'No recorded activity yet'
                        : entry.metrics.daysSinceLastActivity === 0
                          ? 'Active today'
                          : `Last active ${entry.metrics.daysSinceLastActivity} day(s) ago`}
                    </p>
                    <Button variant="ghost" size="sm" asChild>
                      <Link href={`/app/coach/clients/${entry.client.id}`}>
                        Open client <ArrowRight className="h-4 w-4" />
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </section>

      {roster.length > needsAttention.length ? (
        <section className="mt-10">
          <h2 className="text-lg font-semibold tracking-tight">Steady</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {roster
              .filter((entry) => entry.risk.level === 'stable')
              .map((entry) => (
                <Link
                  key={entry.client.id}
                  href={`/app/coach/clients/${entry.client.id}`}
                  className="surface flex items-center justify-between p-4 transition-colors hover:bg-muted/40"
                >
                  <span className="font-medium">
                    {displayName(entry.client)}
                  </span>
                  <span className="text-sm text-muted-foreground tabular">
                    {formatRate(entry.metrics.followThrough30.rate)}
                  </span>
                </Link>
              ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
