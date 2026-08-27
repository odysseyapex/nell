'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ANALYTICS_EVENTS } from '@/lib/analytics';
import { track } from '@/components/shared/analytics-provider';
import { type Plan, formatPrice } from '@/lib/billing/plans';

/**
 * Plan selection.
 *
 * Checkout is started server-side and the browser is redirected to Stripe —
 * no card details ever touch Nellvia.
 */
export function BillingPlans({
  plans,
  currentPlan,
  billingEnabled,
  hasCustomer,
}: {
  plans: Plan[];
  currentPlan: string;
  billingEnabled: boolean;
  hasCustomer: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [busyPlan, setBusyPlan] = useState<string | null>(null);

  const go = async (path: string, body?: unknown) => {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
    if (!response.ok || !data.url) {
      toast.error(data.error ?? 'Could not open the billing session.');
      return;
    }
    window.location.href = data.url;
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {plans.map((plan) => {
          const isCurrent = plan.id === currentPlan;
          return (
            <Card key={plan.id} className={isCurrent ? 'border-foreground/30' : undefined}>
              <CardContent className="flex h-full flex-col p-5">
                <div className="flex items-center justify-between">
                  <p className="font-medium">{plan.name}</p>
                  {isCurrent ? <Badge variant="muted">Current</Badge> : null}
                </div>
                <p className="mt-3 text-2xl font-semibold tabular">
                  {formatPrice(plan)}
                  <span className="text-sm font-normal text-muted-foreground">/mo</span>
                </p>
                <p className="mt-1 text-sm text-muted-foreground">{plan.clientLimit} clients</p>
                <ul className="mt-4 flex-1 space-y-1.5 text-sm text-muted-foreground">
                  {plan.features.map((feature) => (
                    <li key={feature}>· {feature}</li>
                  ))}
                </ul>
                <Button
                  className="mt-5"
                  variant={isCurrent ? 'outline' : 'default'}
                  disabled={!billingEnabled || isCurrent || pending}
                  onClick={() => {
                    setBusyPlan(plan.id);
                    track(ANALYTICS_EVENTS.checkoutStarted, { plan: plan.id });
                    startTransition(() => {
                      void go('/api/stripe/checkout', { plan: plan.id });
                    });
                  }}
                >
                  {busyPlan === plan.id && pending
                    ? 'Opening…'
                    : isCurrent
                      ? 'Current plan'
                      : `Choose ${plan.name}`}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {hasCustomer && billingEnabled ? (
        <Button variant="outline" onClick={() => startTransition(() => void go('/api/stripe/portal'))}>
          Manage payment method and invoices
        </Button>
      ) : null}
    </div>
  );
}
