import { redirect } from 'next/navigation';

import { AppNav } from '@/components/shared/app-nav';
import { brandStyle } from '@/lib/branding';
import { requireSession } from '@/lib/auth/session';
import { isDemoMode } from '@/lib/demo/supabase';

export const dynamic = 'force-dynamic';

/**
 * The application shell.
 *
 * Resolves the session once for every page beneath it and applies the
 * organization's branding as CSS custom properties, so tenant styling never
 * requires a separate deployment.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();

  // A super admin has no organization; they belong in the platform console.
  if (session.profile.role === 'super_admin') redirect('/admin');
  if (!session.organization) redirect('/onboarding');

  const { organization, profile } = session;

  if (organization.status === 'cancelled' && profile.role !== 'organization_owner') {
    return (
      <div className="mx-auto max-w-lg px-6 py-24 text-center">
        <h1 className="text-xl font-semibold">This workspace is closed</h1>
        <p className="mt-3 text-muted-foreground">
          {organization.name} is no longer active on Nellvia. Please contact your coach.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background" style={brandStyle(organization)}>
      {/* Nobody should ever mistake the demo for a real client's record. */}
      {isDemoMode() ? (
        <div className="bg-[hsl(var(--signal-watch))] px-4 py-1.5 text-center text-xs font-medium text-white">
          Demo workspace — generated data, stored in memory.{' '}
          <a href="/demo" className="underline underline-offset-2">
            Switch person
          </a>
        </div>
      ) : null}
      <AppNav profile={profile} organization={organization} />
      <main className="flex-1 pb-24 md:pb-12">{children}</main>
    </div>
  );
}
