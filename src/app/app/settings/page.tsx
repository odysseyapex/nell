import Link from 'next/link';
import type { Metadata } from 'next';

import { Card, CardContent } from '@/components/ui/card';
import { requireStaff } from '@/lib/auth/session';
import { features } from '@/lib/env';
import { getPlan, formatPrice } from '@/lib/billing/plans';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Settings' };
export const dynamic = 'force-dynamic';

/**
 * Settings overview.
 *
 * Doubles as a health check: a coach can see at a glance whether the pieces
 * that make Nell useful are actually in place, rather than discovering a
 * missing framework when a client has nothing to do.
 */
export default async function SettingsOverviewPage() {
  const { organization } = await requireStaff();
  const supabase = await createSupabaseServerClient();

  const [{ count: frameworks }, { count: exercises }, { count: clients }, { count: reasons }] =
    await Promise.all([
      supabase.from('frameworks').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('exercises').select('id', { count: 'exact', head: true }).eq('active', true),
      supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'client'),
      supabase.from('reason_codes').select('id', { count: 'exact', head: true }).eq('active', true),
    ]);

  const plan = getPlan(organization.plan);

  const checks = [
    { label: 'Active framework', value: frameworks ?? 0, href: '/app/settings/framework' },
    { label: 'Active exercises', value: exercises ?? 0, href: '/app/settings/exercises' },
    { label: 'Reason codes', value: reasons ?? 0, href: '/app/settings/reasons' },
    { label: 'Clients', value: clients ?? 0, href: '/app/coach/clients' },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        {checks.map((check) => (
          <Link key={check.label} href={check.href}>
            <Card className="transition-colors hover:bg-muted/40">
              <CardContent className="p-5">
                <p className="metric-label">{check.label}</p>
                <p className="mt-2 metric-value">{check.value}</p>
                {check.value === 0 ? (
                  <p className="mt-1 text-sm text-[hsl(var(--signal-attention))]">
                    Nothing set up yet
                  </p>
                ) : null}
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <Card>
        <CardContent className="space-y-3 p-5">
          <p className="font-medium">Workspace</p>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="metric-label">Plan</dt>
              <dd className="mt-1">
                {organization.pilot_mode ? 'Pilot (no billing)' : `${plan.name} · ${formatPrice(plan)}/month`}
              </dd>
            </div>
            <div>
              <dt className="metric-label">Client limit</dt>
              <dd className="mt-1">{organization.pilot_mode ? 'Unlimited' : organization.client_limit}</dd>
            </div>
            <div>
              <dt className="metric-label">Timezone</dt>
              <dd className="mt-1">{organization.timezone}</dd>
            </div>
            <div>
              <dt className="metric-label">Subscription</dt>
              <dd className="mt-1 capitalize">{organization.subscription_status}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-5">
          <p className="font-medium">Integrations</p>
          <ul className="space-y-2 text-sm">
            {[
              { label: 'AI wording for briefs and insights', on: features.ai, note: 'Nell falls back to plain generated text without it.' },
              { label: 'Email delivery', on: features.email, note: 'Invitations show a copyable link instead.' },
              { label: 'Billing', on: features.billing, note: 'Plan changes are manual without it.' },
              { label: 'Product analytics', on: features.analytics, note: 'Optional.' },
            ].map((item) => (
              <li key={item.label} className="flex items-start justify-between gap-4">
                <div>
                  <p>{item.label}</p>
                  {!item.on ? <p className="text-xs text-muted-foreground">{item.note}</p> : null}
                </div>
                <span className={item.on ? 'text-[hsl(var(--signal-stable))]' : 'text-muted-foreground'}>
                  {item.on ? 'Connected' : 'Not configured'}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
