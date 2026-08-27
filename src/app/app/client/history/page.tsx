import type { Metadata } from 'next';

import { EmptyState } from '@/components/shared/metric-display';
import { HistoryTimeline, type HistoryItem } from '@/components/client/history-timeline';
import { requireClient } from '@/lib/auth/session';
import { getClientFacts } from '@/lib/data/client-view';
import { todayIn } from '@/lib/metrics';
import { addDays } from '@/lib/metrics/dates';

export const metadata: Metadata = { title: 'History' };
export const dynamic = 'force-dynamic';

/**
 * The client's own record, most recent first.
 *
 * This is the screen that makes the app feel like it belongs to them rather
 * than to their coach: their decisions, their words, kept where they can read
 * them back.
 */
export default async function ClientHistoryPage() {
  const { profile, organization } = await requireClient();
  const timezone = profile.timezone ?? organization.timezone;
  const referenceDate = todayIn(timezone);

  const facts = await getClientFacts(profile.id, addDays(referenceDate, -180));

  const items: HistoryItem[] = facts
    .filter((fact) => fact.status !== 'planned')
    .map((fact) => ({
      id: fact.commitment_id,
      date: fact.commitment_date,
      text: fact.commitment_text,
      status: fact.status,
      reason: fact.reason_name,
      category: fact.commitment_category,
      confidence: fact.confidence_score,
    }));

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-8 sm:px-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">History</h1>
        <p className="mt-1 text-muted-foreground">Everything you have recorded.</p>
      </header>

      {items.length === 0 ? (
        <EmptyState
          title="Nothing here yet"
          description="Your commitments and what happened to them will build up here as you go."
        />
      ) : (
        <HistoryTimeline items={items} />
      )}
    </div>
  );
}
