import type { Metadata } from 'next';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { CheckinCard } from '@/components/client/checkin-card';
import { CommitmentForm } from '@/components/client/commitment-form';
import { EmptyState } from '@/components/shared/metric-display';
import { requireClient } from '@/lib/auth/session';
import { getClientFacts, getTodayView } from '@/lib/data/client-view';
import { addDays } from '@/lib/metrics/dates';

export const metadata: Metadata = { title: 'Commitments' };
export const dynamic = 'force-dynamic';

const STATUS_STYLE = {
  completed: { variant: 'stable' as const, label: 'Followed through' },
  changed: { variant: 'watch' as const, label: 'Changed' },
  missed: { variant: 'attention' as const, label: "Didn't happen" },
  planned: { variant: 'muted' as const, label: 'Planned' },
  cancelled: { variant: 'muted' as const, label: 'Cancelled' },
};

export default async function CommitmentsPage() {
  const { profile, organization } = await requireClient();
  const timezone = profile.timezone ?? organization.timezone;

  const view = await getTodayView(profile.id, timezone);
  const facts = await getClientFacts(profile.id, addDays(view.today, -60));
  const resolved = facts.filter((fact) => fact.status !== 'planned');

  return (
    <div className="mx-auto max-w-2xl space-y-8 px-4 py-8 sm:px-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Commitments</h1>
        <p className="mt-1 text-muted-foreground">What you said you would do, and what happened.</p>
      </header>

      {view.dueCheckins.length > 0 ? (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold tracking-tight">Waiting on you</h2>
          {view.dueCheckins.map((commitment) => (
            <CheckinCard key={commitment.id} commitment={commitment} reasonCodes={view.reasonCodes} />
          ))}
        </section>
      ) : null}

      <section className="space-y-4">
        <h2 className="text-lg font-semibold tracking-tight">Make a commitment</h2>
        <CommitmentForm today={view.today} tomorrow={addDays(view.today, 1)} />
      </section>

      {view.upcoming.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">Planned</h2>
          {view.upcoming.map((commitment) => (
            <Card key={commitment.id}>
              <CardContent className="flex items-center justify-between gap-4 p-4">
                <div className="min-w-0">
                  <p className="font-medium">{commitment.commitment_text}</p>
                  <p className="text-sm text-muted-foreground">
                    {commitment.commitment_date}
                    {commitment.confidence_score !== null
                      ? ` · ${commitment.confidence_score}% confident`
                      : ''}
                  </p>
                </div>
                <Badge variant="muted">Planned</Badge>
              </CardContent>
            </Card>
          ))}
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Recent</h2>
        {resolved.length === 0 ? (
          <EmptyState
            title="Nothing recorded yet"
            description="Once you check in on a commitment it appears here, alongside what influenced it."
          />
        ) : (
          resolved.slice(0, 40).map((fact) => {
            const style = STATUS_STYLE[fact.status];
            return (
              <Card key={fact.commitment_id}>
                <CardContent className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">{fact.commitment_text}</p>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {fact.commitment_date}
                        {fact.confidence_score !== null ? ` · ${fact.confidence_score}% confident` : ''}
                        {fact.reason_name ? ` · ${fact.reason_name}` : ''}
                      </p>
                    </div>
                    <Badge variant={style.variant}>{style.label}</Badge>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </section>
    </div>
  );
}
