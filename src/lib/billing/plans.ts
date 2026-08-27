/**
 * Plan configuration.
 *
 * Single source of truth for pricing and limits. Nothing else in the codebase
 * hard-codes a price or a client cap — the marketing page, the billing screen,
 * the invite guard and the Stripe checkout call all read from here.
 */

export type PlanId = 'starter' | 'coach' | 'pro' | 'scale';

export interface Plan {
  id: PlanId;
  name: string;
  /** Monthly price in the smallest currency unit. */
  priceCents: number;
  currency: 'usd';
  clientLimit: number;
  tagline: string;
  features: string[];
  /** Stripe price id, read from the environment so test and live can differ. */
  priceEnvKey: string;
  highlighted?: boolean;
}

export const PLANS: Record<PlanId, Plan> = {
  starter: {
    id: 'starter',
    name: 'Starter',
    priceCents: 4900,
    currency: 'usd',
    clientLimit: 10,
    tagline: 'For a coach getting their first roster into Nellvia.',
    features: [
      'Up to 10 active clients',
      'Commitments, check-ins and follow-through',
      'Pattern detection and Needs Attention',
      'Weekly attention email',
    ],
    priceEnvKey: 'STRIPE_PRICE_STARTER',
  },
  coach: {
    id: 'coach',
    name: 'Coach',
    priceCents: 9900,
    currency: 'usd',
    clientLimit: 30,
    tagline: 'For a full-time one-to-one practice.',
    features: [
      'Up to 30 active clients',
      'Everything in Starter',
      'Coaching briefs',
      'Experiments with measured results',
    ],
    priceEnvKey: 'STRIPE_PRICE_COACH',
    highlighted: true,
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    priceCents: 19900,
    currency: 'usd',
    clientLimit: 100,
    tagline: 'For a coach with a waiting list, or a small team.',
    features: [
      'Up to 100 active clients',
      'Everything in Coach',
      'Multiple coaches with client assignment',
      'Organization-wide analytics',
    ],
    priceEnvKey: 'STRIPE_PRICE_PRO',
  },
  scale: {
    id: 'scale',
    name: 'Scale',
    priceCents: 39900,
    currency: 'usd',
    clientLimit: 250,
    tagline: 'For a coaching business with a coaching team.',
    features: [
      'Up to 250 active clients',
      'Everything in Pro',
      'Custom framework versioning',
      'Priority support',
    ],
    priceEnvKey: 'STRIPE_PRICE_SCALE',
  },
};

export const PLAN_ORDER: PlanId[] = ['starter', 'coach', 'pro', 'scale'];

export function getPlan(id: string): Plan {
  return PLANS[(id as PlanId) in PLANS ? (id as PlanId) : 'starter'];
}

export function formatPrice(plan: Plan): string {
  return `$${(plan.priceCents / 100).toFixed(0)}`;
}

export function priceIdFor(plan: Plan): string | null {
  return process.env[plan.priceEnvKey] ?? null;
}

export function planForPriceId(priceId: string): Plan | null {
  for (const id of PLAN_ORDER) {
    if (process.env[PLANS[id].priceEnvKey] === priceId) return PLANS[id];
  }
  return null;
}

/**
 * Whether an organization may add another active client.
 *
 * Pilot organizations are exempt: founding partners are onboarded manually
 * before any payment relationship exists.
 */
export function canAddClient(params: {
  plan: string;
  clientLimit: number;
  activeClients: number;
  pilotMode: boolean;
}): { allowed: boolean; reason?: string } {
  if (params.pilotMode) return { allowed: true };
  if (params.activeClients >= params.clientLimit) {
    return {
      allowed: false,
      reason: `This plan covers ${params.clientLimit} active clients and ${params.activeClients} are in use. Upgrade to invite more.`,
    };
  }
  return { allowed: true };
}
