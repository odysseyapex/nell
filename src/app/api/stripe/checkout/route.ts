import { NextResponse } from 'next/server';
import { z } from 'zod';

import { authorize, jsonError } from '@/lib/auth/api';
import { PLANS, type PlanId, priceIdFor } from '@/lib/billing/plans';
import { getStripe, isBillingConfigured } from '@/lib/billing/stripe';
import { env } from '@/lib/env';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

const BodySchema = z.object({ plan: z.enum(['starter', 'coach', 'pro', 'scale']) });

/**
 * Starts a Stripe Checkout session.
 *
 * The organization is taken from the session, never from the request body, so
 * a caller cannot start a checkout that would upgrade somebody else's
 * workspace. The organization id travels in client_reference_id and metadata
 * so the webhook can find its way back without trusting anything from the
 * browser.
 */
export async function POST(request: Request) {
  const auth = await authorize(['organization_owner']);
  if (!auth.ok) return auth.response;

  if (!isBillingConfigured()) {
    return jsonError(503, 'Billing is not configured on this deployment.');
  }

  const organization = auth.session.organization;
  if (!organization) return jsonError(400, 'No organization on this account.');

  const parsed = BodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return jsonError(400, 'Unknown plan.');

  const plan = PLANS[parsed.data.plan as PlanId];
  const priceId = priceIdFor(plan);
  if (!priceId) {
    return jsonError(503, `No Stripe price is configured for the ${plan.name} plan.`);
  }

  const stripe = getStripe();

  let customerId = organization.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({
      name: organization.name,
      email: auth.session.profile.email,
      metadata: { organization_id: organization.id },
    });
    customerId = customer.id;

    const admin = createSupabaseAdminClient();
    await admin
      .from('organizations')
      .update({ stripe_customer_id: customerId })
      .eq('id', organization.id);
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    client_reference_id: organization.id,
    line_items: [{ price: priceId, quantity: 1 }],
    subscription_data: { metadata: { organization_id: organization.id, plan: plan.id } },
    success_url: `${env.NEXT_PUBLIC_APP_URL}/app/settings/billing?checkout=success`,
    cancel_url: `${env.NEXT_PUBLIC_APP_URL}/app/settings/billing?checkout=cancelled`,
  });

  return NextResponse.json({ url: session.url });
}
