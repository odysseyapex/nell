import { NextResponse } from 'next/server';

import { authorize, jsonError } from '@/lib/auth/api';
import { getStripe, isBillingConfigured } from '@/lib/billing/stripe';
import { env } from '@/lib/env';

/** Opens the Stripe billing portal for the caller's own organization. */
export async function POST() {
  const auth = await authorize(['organization_owner']);
  if (!auth.ok) return auth.response;

  if (!isBillingConfigured()) return jsonError(503, 'Billing is not configured.');

  const customerId = auth.session.organization?.stripe_customer_id;
  if (!customerId) return jsonError(400, 'This workspace has no billing account yet.');

  const session = await getStripe().billingPortal.sessions.create({
    customer: customerId,
    return_url: `${env.NEXT_PUBLIC_APP_URL}/app/settings/billing`,
  });

  return NextResponse.json({ url: session.url });
}
