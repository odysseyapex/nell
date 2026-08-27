'use client';

import { useEffect } from 'react';
import posthog from 'posthog-js';
import { PostHogProvider } from 'posthog-js/react';

import type { AnalyticsEvent, AnalyticsProperties } from '@/lib/analytics';

/**
 * PostHog wiring.
 *
 * Autocapture is disabled deliberately. Nellvia's screens are full of client
 * reflection text, and autocapture records the text content of clicked
 * elements — which would quietly ship exactly the material this product
 * promises to keep private. Every event is therefore explicit.
 */
const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const host = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com';

export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (!key || typeof window === 'undefined') return;
    posthog.init(key, {
      api_host: host,
      autocapture: false,
      capture_pageview: true,
      disable_session_recording: true,
      person_profiles: 'identified_only',
    });
  }, []);

  if (!key) return <>{children}</>;
  return <PostHogProvider client={posthog}>{children}</PostHogProvider>;
}

/** Safe to call whether or not PostHog is configured. */
export function track(event: AnalyticsEvent, properties: AnalyticsProperties = {}) {
  if (!key || typeof window === 'undefined') return;
  posthog.capture(event, properties);
}

export function identify(profileId: string, properties: AnalyticsProperties = {}) {
  if (!key || typeof window === 'undefined') return;
  posthog.identify(profileId, properties);
}
