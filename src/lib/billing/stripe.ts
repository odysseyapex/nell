import 'server-only';

import Stripe from 'stripe';

import { ConfigurationError, serverEnv } from '@/lib/env';

let cached: Stripe | null = null;

export function isBillingConfigured(): boolean {
  return Boolean(serverEnv().STRIPE_SECRET_KEY);
}

export function getStripe(): Stripe {
  const { STRIPE_SECRET_KEY } = serverEnv();
  if (!STRIPE_SECRET_KEY) {
    throw new ConfigurationError(
      'STRIPE_SECRET_KEY is not set. Billing is optional — set pilot_mode on the organization to run without it.',
    );
  }
  // Pinned to the version the installed SDK's types describe, so an SDK bump
  // surfaces as a compile error rather than a runtime shape mismatch.
  cached ??= new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2025-02-24.acacia' });
  return cached;
}
