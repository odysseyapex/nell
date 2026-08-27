import type { Metadata } from 'next';

import { Card, CardContent } from '@/components/ui/card';
import { FrameworkBuilder } from '@/components/settings/framework-builder';
import { requireOwner } from '@/lib/auth/session';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { Framework, FrameworkStep } from '@/lib/types';

export const metadata: Metadata = { title: 'Framework' };
export const dynamic = 'force-dynamic';

export default async function FrameworkSettingsPage() {
  await requireOwner();
  const supabase = await createSupabaseServerClient();

  const { data: framework } = await supabase
    .from('frameworks')
    .select('*')
    .eq('status', 'active')
    .order('is_default', { ascending: false })
    .limit(1)
    .maybeSingle<Framework>();

  const { data: steps } = framework
    ? await supabase
        .from('framework_steps')
        .select('*')
        .eq('framework_id', framework.id)
        .order('step_order')
    : { data: [] };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Your framework</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The questions your clients answer. Changing a question after clients have answered it
          creates a new version rather than rewriting their history.
        </p>
      </div>

      {framework ? (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
            <span>
              Currently live: <strong>{framework.name}</strong>
            </span>
            <span className="text-muted-foreground">Version {framework.version}</span>
          </CardContent>
        </Card>
      ) : null}

      <FrameworkBuilder
        frameworkId={framework?.id}
        initialName={framework?.name}
        initialDescription={framework?.description ?? undefined}
        initialSteps={(steps ?? []) as FrameworkStep[]}
        submitLabel={framework ? 'Save changes' : 'Publish framework'}
      />
    </div>
  );
}
