import { NextResponse } from 'next/server';
import type Stripe from 'stripe';

import { recordAudit } from '@/lib/audit';
import { PLANS, planForPriceId } from '@/lib/billing/plans';
import { getStripe, isBillingConfigured } from '@/lib/billing/stripe';
import { serverEnv } from '@/lib/env';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { SubscriptionStatus } from '@/lib/types';

/**
 * Stripe webhook.
 *
 * The signature is verified before anything is read, so an unsigned request
 * can never move a workspace onto a paid plan. The organization is resolved
 * from Stripe's own metadata or customer id — never from a request field that
 * a caller could set.
 */

export const runtime = 'nodejs';
// The raw body is required for signature verification, so this route must not
// be statically analysed or cached.
export const dynamic = 'force-dynamic';

const STATUS_MAP: Record<string, SubscriptionStatus> = {
  active: 'active',
  trialing: 'trialing',
  past_due: 'past_due',
  canceled: 'canceled',
  unpaid: 'past_due',
  incomplete: 'incomplete',
  incomplete_expired: 'canceled',
};

export async function POST(request: Request) {
  if (!isBillingConfigured()) {
    return NextResponse.json({ error: 'Billing not configured' }, { status: 503 });
  }

  const { STRIPE_WEBHOOK_SECRET } = serverEnv();
  if (!STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 503 });
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) return NextResponse.json({ error: 'Missing signature' }, { status: 400 });

  const payload = await request.text();

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(payload, signature, STRIPE_WEBHOOK_SECRET);
  } catch (error) {
    console.error('[stripe] signature verification failed', error);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();

  /** Finds the organization behind an event, preferring explicit metadata. */
  async function resolveOrganizationId(
    metadataOrgId: string | undefined,
    customerId: string | null,
  ): Promise<string | null> {
    if (metadataOrgId) return metadataOrgId;
    if (!customerId) return null;
    const { data } = await admin
      .from('organizations')
      .select('id')
      .eq('stripe_customer_id', customerId)
      .maybeSingle<{ id: string }>();
    return data?.id ?? null;
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const organizationId =
          session.client_reference_id ??
          (await resolveOrganizationId(undefined, typeof session.customer === 'string' ? session.customer : null));

        if (organizationId) {
          await admin
            .from('organizations')
            .update({
              stripe_customer_id:
                typeof session.customer === 'string' ? session.customer : undefined,
              stripe_subscription_id:
                typeof session.subscription === 'string' ? session.subscription : undefined,
              subscription_status: 'active',
              status: 'active',
            })
            .eq('id', organizationId);

          await recordAudit({
            organizationId,
            userId: null,
            action: 'subscription.changed',
            entityType: 'organization',
            entityId: organizationId,
            metadata: { event: event.type },
          });
        }
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const organizationId = await resolveOrganizationId(
          subscription.metadata?.organization_id,
          typeof subscription.customer === 'string' ? subscription.customer : null,
        );
        if (!organizationId) break;

        const priceId = subscription.items.data[0]?.price?.id;
        const plan = priceId ? planForPriceId(priceId) : null;

        await admin
          .from('organizations')
          .update({
            stripe_subscription_id: subscription.id,
            subscription_status: STATUS_MAP[subscription.status] ?? 'incomplete',
            ...(plan ? { plan: plan.id, client_limit: plan.clientLimit } : {}),
          })
          .eq('id', organizationId);

        await recordAudit({
          organizationId,
          userId: null,
          action: 'subscription.changed',
          entityType: 'organization',
          entityId: organizationId,
          metadata: { event: event.type, plan: plan?.id ?? null, status: subscription.status },
        });
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const organizationId = await resolveOrganizationId(
          subscription.metadata?.organization_id,
          typeof subscription.customer === 'string' ? subscription.customer : null,
        );
        if (!organizationId) break;

        // The workspace is paused rather than cancelled: coaches keep read
        // access to their clients' history while they decide what to do.
        await admin
          .from('organizations')
          .update({
            subscription_status: 'canceled',
            status: 'paused',
            plan: PLANS.starter.id,
            client_limit: PLANS.starter.clientLimit,
          })
          .eq('id', organizationId);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const organizationId = await resolveOrganizationId(
          undefined,
          typeof invoice.customer === 'string' ? invoice.customer : null,
        );
        if (!organizationId) break;

        await admin
          .from('organizations')
          .update({ subscription_status: 'past_due' })
          .eq('id', organizationId);
        break;
      }

      default:
        // Unhandled event types are acknowledged so Stripe stops retrying.
        break;
    }
  } catch (error) {
    console.error('[stripe] webhook handling failed', event.type, error);
    // A 500 tells Stripe to retry, which is what we want for a transient fault.
    return NextResponse.json({ error: 'Handler failed' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
