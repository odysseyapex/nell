import type { Metadata } from 'next';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { BillingPlans } from '@/components/settings/billing-plans';
import { requireOwner } from '@/lib/auth/session';
import { features } from '@/lib/env';
import { PLANS, PLAN_ORDER, getPlan } from '@/lib/billing/plans';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Billing' };
export const dynamic = 'force-dynamic';

export default async function BillingSettingsPage() {
  const { organization } = await requireOwner();
  const supabase = await createSupabaseServerClient();

  const { count: clients } = await supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'client')
    .in('status', ['active', 'invited']);

  const current = getPlan(organization.plan);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Billing</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Priced by active client roster. Changing plan takes effect immediately.
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div>
            <p className="metric-label">Current plan</p>
            <p className="mt-1 text-lg font-semibold">
              {organization.pilot_mode ? 'Pilot' : current.name}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {clients ?? 0} of {organization.pilot_mode ? 'unlimited' : organization.client_limit}{' '}
              active clients
            </p>
          </div>
          <Badge
            variant={
              organization.subscription_status === 'active'
                ? 'stable'
                : organization.subscription_status === 'past_due'
                  ? 'attention'
                  : 'muted'
            }
          >
            {organization.pilot_mode ? 'Pilot workspace' : organization.subscription_status}
          </Badge>
        </CardContent>
      </Card>

      {organization.pilot_mode ? (
        <div className="evidence">
          This is a pilot workspace. Client limits are not enforced and no payment method is
          required. Billing can be switched on later without touching any data.
        </div>
      ) : null}

      {!features.billing ? (
        <div className="evidence">
          Stripe is not configured on this deployment, so plans cannot be changed from here. Set
          STRIPE_SECRET_KEY and the plan price ids, or run the workspace in pilot mode.
        </div>
      ) : null}

      <BillingPlans
        plans={PLAN_ORDER.map((id) => PLANS[id])}
        currentPlan={organization.plan}
        billingEnabled={features.billing && !organization.pilot_mode}
        hasCustomer={Boolean(organization.stripe_customer_id)}
      />
    </div>
  );
}
