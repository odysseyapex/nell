import { z } from 'zod';

/**
 * Environment access.
 *
 * Validation is lazy on purpose. `next build` imports every module in the app,
 * so throwing at import time would make a missing key a build failure rather
 * than a runtime error — and CI would need production secrets just to compile.
 * Instead the values are read as-is and checked at the point of use, where the
 * error message can say what the caller was trying to do.
 *
 * Server secrets are reached only through serverEnv(), which refuses to run in
 * the browser, so a shared import can never drag a secret into a client bundle.
 */

// Next.js inlines NEXT_PUBLIC_* only where referenced statically, hence the
// explicit property reads rather than a loop over process.env.
export const env = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
  NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY ?? '',
  NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com',
  NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN ?? '',
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '',
};

const supabaseSchema = z.object({
  url: z.string().url(),
  anonKey: z.string().min(1),
});

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

/** Throws a message a developer can act on, at the moment a query is attempted. */
export function requireSupabaseConfig() {
  const parsed = supabaseSchema.safeParse({
    url: env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });

  if (!parsed.success) {
    throw new ConfigurationError(
      'Supabase is not configured. Copy .env.example to .env.local and set ' +
        'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, then restart the dev server.',
    );
  }
  return parsed.data;
}

export function isSupabaseConfigured(): boolean {
  return supabaseSchema.safeParse({
    url: env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  }).success;
}

export function serverEnv() {
  if (typeof window !== 'undefined') {
    throw new ConfigurationError(
      'serverEnv() was called in the browser. Server secrets must never be bundled.',
    );
  }
  return {
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
    OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? '',
    OPENAI_MODEL: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY ?? '',
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET ?? '',
    RESEND_API_KEY: process.env.RESEND_API_KEY ?? '',
    RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL ?? 'Nell <onboarding@resend.dev>',
    CRON_SECRET: process.env.CRON_SECRET ?? '',
    SENTRY_DSN: process.env.SENTRY_DSN ?? '',
  };
}

/**
 * Feature availability, so the UI can degrade honestly rather than error.
 * Every one of these is optional: Nell's core loop works without any of them.
 */
export const features = {
  get ai() {
    return Boolean(process.env.OPENAI_API_KEY);
  },
  get billing() {
    return Boolean(process.env.STRIPE_SECRET_KEY);
  },
  get email() {
    return Boolean(process.env.RESEND_API_KEY);
  },
  get analytics() {
    return Boolean(env.NEXT_PUBLIC_POSTHOG_KEY);
  },
};
