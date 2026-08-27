import type { Metadata } from 'next';

import { Button } from '@/components/ui/button';
import { ClientsTable, type ClientRow } from '@/components/coach/clients-table';
import { InviteClientDialog } from '@/components/coach/invite-client-dialog';
import { requireStaff } from '@/lib/auth/session';
import { getRoster } from '@/lib/data/intelligence';
import { canAddClient } from '@/lib/billing/plans';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { Profile } from '@/lib/types';
import { displayName } from '@/lib/format';

export const metadata: Metadata = { title: 'Clients' };
export const dynamic = 'force-dynamic';

export default async function ClientsPage() {
  const { organization, profile } = await requireStaff();
  const roster = await getRoster(organization.timezone);

  const supabase = await createSupabaseServerClient();
  const { data: coaches } = await supabase
    .from('profiles')
    .select('id, first_name, last_name, email')
    .in('role', ['coach', 'organization_owner'])
    .eq('status', 'active');

  const capacity = canAddClient({
    plan: organization.plan,
    clientLimit: organization.client_limit,
    activeClients: roster.length,
    pilotMode: organization.pilot_mode,
  });

  // Only the fields the table needs cross to the client bundle — no
  // commitment text, no reasons, no notes.
  const rows: ClientRow[] = roster.map((entry) => ({
    id: entry.client.id,
    name: displayName(entry.client),
    email: entry.client.email,
    coachName: entry.coachName,
    status: entry.client.status,
    followThrough7: entry.metrics.followThrough7.rate,
    followThrough7Counts: `${entry.metrics.followThrough7.completed}/${entry.metrics.followThrough7.eligible}`,
    followThrough30: entry.metrics.followThrough30.rate,
    followThrough30Counts: `${entry.metrics.followThrough30.completed}/${entry.metrics.followThrough30.eligible}`,
    trend: entry.metrics.trend,
    trendDelta: entry.metrics.trendDelta,
    risk: entry.risk.level,
    riskReason: entry.risk.reasons[0]?.label ?? null,
    daysSinceActivity: entry.metrics.daysSinceLastActivity,
    openAlerts: entry.openAlertCount,
  }));

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Clients</h1>
          <p className="mt-1 text-muted-foreground">
            {roster.length} of {organization.pilot_mode ? 'unlimited' : organization.client_limit} active
            {organization.pilot_mode ? ' · pilot workspace' : ''}
          </p>
        </div>

        {capacity.allowed ? (
          <InviteClientDialog
            coaches={((coaches ?? []) as Profile[]).map((coach) => ({
              id: coach.id,
              name: displayName(coach),
            }))}
            defaultCoachId={profile.role === 'coach' ? profile.id : (coaches?.[0]?.id ?? '')}
          />
        ) : (
          <div className="text-right">
            <p className="text-sm text-muted-foreground">{capacity.reason}</p>
            <Button variant="outline" className="mt-2" asChild>
              <a href="/app/settings/billing">Upgrade plan</a>
            </Button>
          </div>
        )}
      </header>

      <div className="mt-8">
        <ClientsTable rows={rows} />
      </div>
    </div>
  );
}
