import type { Metadata } from 'next';

import { Card, CardContent } from '@/components/ui/card';
import { ClientSettingsForm } from '@/components/client/settings-form';
import { requireClient } from '@/lib/auth/session';
import { ensureClientPreferences } from '@/lib/data/client-view';

export const metadata: Metadata = { title: 'Settings' };
export const dynamic = 'force-dynamic';

/**
 * Client settings.
 *
 * Deliberately tiny: when to be reminded, and what to be reminded about.
 * Everything else about how this workspace behaves belongs to the coach.
 */
export default async function ClientSettingsPage() {
  const { profile, organization } = await requireClient();
  const timezone = profile.timezone ?? organization.timezone;
  const preferences = await ensureClientPreferences(profile.id, organization.id, timezone);

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-8 sm:px-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-muted-foreground">When Nellvia should get in touch.</p>
      </header>

      <ClientSettingsForm
        preferredCheckinTime={(preferences?.preferred_checkin_time ?? '19:00').slice(0, 5)}
        notifications={preferences?.notification_preferences ?? {}}
      />

      <Card>
        <CardContent className="space-y-2 p-5 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">What your coach sees</p>
          <p>
            {organization.name} can see the commitments you make, what you record about what
            happened, and the patterns Nellvia finds across them. They cannot see anything you have
            not recorded here.
          </p>
          <p>
            Nellvia is a coaching support tool. It is not a medical or therapeutic service and does
            not diagnose or treat anything.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
