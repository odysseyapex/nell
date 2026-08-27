import type { Metadata } from 'next';

import { MethodStep } from '@/components/onboarding/steps';
import { requireOwner } from '@/lib/auth/session';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { OrganizationAiSettings } from '@/lib/types';

export const metadata: Metadata = { title: 'Coaching method' };
export const dynamic = 'force-dynamic';

export default async function MethodSettingsPage() {
  const { organization } = await requireOwner();
  const supabase = await createSupabaseServerClient();

  const { data: settings } = await supabase
    .from('organization_ai_settings')
    .select('*')
    .eq('organization_id', organization.id)
    .maybeSingle<OrganizationAiSettings>();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Coaching method</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Shapes how Nell writes for you. It never changes what Nell measures.
        </p>
      </div>

      <MethodStep
        coachPhilosophy={settings?.coach_philosophy ?? ''}
        preferredTone={settings?.preferred_tone ?? ''}
        systemGuidelines={settings?.system_guidelines ?? ''}
        terminology={Object.entries(settings?.preferred_terminology_json ?? {})
          .map(([from, to]) => `${from}=${to}`)
          .join(', ')}
        forbiddenTopics={(settings?.forbidden_topics_json ?? []).join(', ')}
        redirectTo="/app/settings/method"
      />
    </div>
  );
}
