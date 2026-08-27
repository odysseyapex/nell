import type { Metadata } from 'next';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { InviteCoachForm } from '@/components/settings/invite-coach-form';
import { requireStaff } from '@/lib/auth/session';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { Invitation, Profile } from '@/lib/types';
import { displayName } from '@/lib/format';

export const metadata: Metadata = { title: 'Team' };
export const dynamic = 'force-dynamic';

export default async function TeamSettingsPage() {
  const { profile } = await requireStaff();
  const supabase = await createSupabaseServerClient();

  const [{ data: staff }, { data: invitations }] = await Promise.all([
    supabase
      .from('profiles')
      .select('*')
      .in('role', ['organization_owner', 'coach'])
      .order('created_at'),
    supabase
      .from('invitations')
      .select('*')
      .eq('status', 'pending')
      .eq('role', 'coach')
      .order('created_at', { ascending: false }),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Team</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Coaches see only the clients assigned to them. Owners see everyone in the workspace.
        </p>
      </div>

      <div className="space-y-3">
        {((staff ?? []) as Profile[]).map((member) => (
          <Card key={member.id}>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <p className="font-medium">
                  {displayName(member)}
                </p>
                <p className="text-sm text-muted-foreground">{member.email}</p>
              </div>
              <Badge variant="muted">
                {member.role === 'organization_owner' ? 'Owner' : 'Coach'}
              </Badge>
            </CardContent>
          </Card>
        ))}
      </div>

      {((invitations ?? []) as Invitation[]).length > 0 ? (
        <div className="space-y-3">
          <h3 className="font-semibold">Pending invitations</h3>
          {((invitations ?? []) as Invitation[]).map((invitation) => (
            <Card key={invitation.id}>
              <CardContent className="flex items-center justify-between gap-3 p-4 text-sm">
                <span>{invitation.email}</span>
                <span className="text-muted-foreground">
                  expires {invitation.expires_at.slice(0, 10)}
                </span>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}

      {profile.role === 'organization_owner' ? (
        <div>
          <h3 className="font-semibold">Invite a coach</h3>
          <div className="mt-4 max-w-md">
            <InviteCoachForm />
          </div>
        </div>
      ) : null}
    </div>
  );
}
