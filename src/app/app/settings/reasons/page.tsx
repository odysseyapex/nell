import type { Metadata } from 'next';

import { ReasonCodesStep } from '@/components/onboarding/steps';
import { requireOwner } from '@/lib/auth/session';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { ReasonCode } from '@/lib/types';

export const metadata: Metadata = { title: 'Reasons' };
export const dynamic = 'force-dynamic';

export default async function ReasonsSettingsPage() {
  await requireOwner();
  const supabase = await createSupabaseServerClient();

  const { data: reasons } = await supabase
    .from('reason_codes')
    .select('*')
    .eq('active', true)
    .order('sort_order');

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Reasons</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          What clients choose from when a commitment did not go to plan.
        </p>
      </div>

      <ReasonCodesStep
        reasonCodes={(reasons ?? []) as ReasonCode[]}
        redirectTo="/app/settings/reasons"
      />
    </div>
  );
}
