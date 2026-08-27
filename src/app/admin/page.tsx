import type { Metadata } from 'next';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { MetricCard } from '@/components/shared/metric-display';
import { requireSuperAdmin } from '@/lib/auth/session';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { signOut } from '@/app/(auth)/actions';
import { Button } from '@/components/ui/button';
import type { Organization } from '@/lib/types';

export const metadata: Metadata = { title: 'Platform admin' };
export const dynamic = 'force-dynamic';

/**
 * Platform console.
 *
 * Deliberately narrow. It shows the shape of each workspace — size, plan,
 * health, AI spend — and nothing a client wrote. There is no impersonation and
 * no journal access: the operational questions this console answers do not
 * require reading anybody's reflections, and building the capability would
 * make the privacy promise conditional on our restraint.
 */
export default async function AdminPage() {
  await requireSuperAdmin();

  const admin = createSupabaseAdminClient();
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();

  const [{ data: organizations }, { data: profiles }, { data: usage }, { data: errors }] =
    await Promise.all([
      admin.from('organizations').select('*').order('created_at', { ascending: false }),
      admin.from('profiles').select('organization_id, role, status'),
      admin
        .from('ai_usage_events')
        .select('organization_id, prompt_tokens, completion_tokens, succeeded')
        .gte('created_at', since),
      admin
        .from('ai_usage_events')
        .select('organization_id, feature, error_code, created_at')
        .eq('succeeded', false)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(20),
    ]);

  const orgRows = (organizations ?? []) as Organization[];

  const counts = new Map<string, { coaches: number; clients: number }>();
  for (const profile of (profiles ?? []) as {
    organization_id: string | null;
    role: string;
    status: string;
  }[]) {
    if (!profile.organization_id) continue;
    const entry = counts.get(profile.organization_id) ?? { coaches: 0, clients: 0 };
    if (profile.role === 'client') entry.clients += 1;
    else entry.coaches += 1;
    counts.set(profile.organization_id, entry);
  }

  const tokensByOrg = new Map<string, number>();
  let totalTokens = 0;
  let failedCalls = 0;
  for (const event of (usage ?? []) as {
    organization_id: string | null;
    prompt_tokens: number;
    completion_tokens: number;
    succeeded: boolean;
  }[]) {
    const tokens = event.prompt_tokens + event.completion_tokens;
    totalTokens += tokens;
    if (!event.succeeded) failedCalls += 1;
    if (event.organization_id) {
      tokensByOrg.set(event.organization_id, (tokensByOrg.get(event.organization_id) ?? 0) + tokens);
    }
  }

  const totalClients = [...counts.values()].reduce((sum, entry) => sum + entry.clients, 0);
  const paying = orgRows.filter((org) => org.subscription_status === 'active').length;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Platform</h1>
          <p className="mt-1 text-muted-foreground">
            Workspace health and usage. No client content is shown here.
          </p>
        </div>
        <form action={signOut}>
          <Button type="submit" variant="outline">
            Sign out
          </Button>
        </form>
      </header>

      <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Organizations" value={String(orgRows.length)} />
        <MetricCard
          label="Paying"
          value={String(paying)}
          detail={`${orgRows.filter((o) => o.pilot_mode).length} pilot`}
        />
        <MetricCard label="Clients" value={String(totalClients)} />
        <MetricCard
          label="AI tokens (30d)"
          value={totalTokens.toLocaleString()}
          detail={`${failedCalls} failed call(s)`}
        />
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold tracking-tight">Organizations</h2>
        <div className="surface mt-4 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Subscription</TableHead>
                <TableHead>Coaches</TableHead>
                <TableHead>Clients</TableHead>
                <TableHead>Limit</TableHead>
                <TableHead>AI tokens (30d)</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orgRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                    No organizations yet.
                  </TableCell>
                </TableRow>
              ) : (
                orgRows.map((org) => {
                  const entry = counts.get(org.id) ?? { coaches: 0, clients: 0 };
                  return (
                    <TableRow key={org.id}>
                      <TableCell>
                        <p className="font-medium">{org.name}</p>
                        <p className="text-xs text-muted-foreground">/{org.slug}</p>
                      </TableCell>
                      <TableCell className="capitalize">
                        {org.pilot_mode ? 'Pilot' : org.plan}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            org.subscription_status === 'active'
                              ? 'stable'
                              : org.subscription_status === 'past_due'
                                ? 'attention'
                                : 'muted'
                          }
                        >
                          {org.subscription_status}
                        </Badge>
                      </TableCell>
                      <TableCell className="tabular">{entry.coaches}</TableCell>
                      <TableCell className="tabular">{entry.clients}</TableCell>
                      <TableCell className="tabular">
                        {org.pilot_mode ? '∞' : org.client_limit}
                      </TableCell>
                      <TableCell className="tabular">
                        {(tokensByOrg.get(org.id) ?? 0).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {org.created_at.slice(0, 10)}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold tracking-tight">Recent AI failures</h2>
        <Card className="mt-4">
          <CardContent className="p-5">
            {((errors ?? []) as { feature: string; error_code: string | null; created_at: string }[])
              .length === 0 ? (
              <p className="text-sm text-muted-foreground">No AI failures in the last 30 days.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {((errors ?? []) as { feature: string; error_code: string | null; created_at: string }[]).map(
                  (event, index) => (
                    <li key={`${event.created_at}-${index}`} className="flex justify-between gap-4">
                      <span>
                        {event.feature} — {event.error_code ?? 'unknown'}
                      </span>
                      <span className="text-muted-foreground">
                        {new Date(event.created_at).toLocaleString()}
                      </span>
                    </li>
                  ),
                )}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
