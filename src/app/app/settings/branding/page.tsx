import type { Metadata } from 'next';

import { BrandingStep } from '@/components/onboarding/steps';
import { requireOwner } from '@/lib/auth/session';

export const metadata: Metadata = { title: 'Branding' };
export const dynamic = 'force-dynamic';

export default async function BrandingSettingsPage() {
  const { organization } = await requireOwner();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Branding</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Applied everywhere your clients see Nell, including invitation emails.
        </p>
      </div>

      <BrandingStep
        primaryColor={organization.primary_color}
        secondaryColor={organization.secondary_color}
        welcomeMessage={organization.welcome_message ?? ''}
        logoUrl={organization.logo_url ?? ''}
        redirectTo="/app/settings/branding"
      />
    </div>
  );
}
