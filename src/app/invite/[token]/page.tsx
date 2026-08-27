import type { Metadata } from 'next';
import Link from 'next/link';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getInvitationPreview } from '@/app/(auth)/actions';
import { AcceptInviteForm } from './accept-form';

export const metadata: Metadata = { title: 'Accept your invitation' };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invitation = await getInvitationPreview(token);

  if (!invitation) {
    return (
      <div className="mx-auto max-w-md px-6 py-24">
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">This invitation is no longer valid</CardTitle>
            <CardDescription>
              Invitations expire after 14 days and can only be used once. Ask your coach to send a
              new one.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/login" className="text-sm font-medium underline underline-offset-4">
              Sign in instead
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-6 py-16">
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">
            {invitation.firstName ? `Hi ${invitation.firstName},` : 'Welcome'}
          </CardTitle>
          <CardDescription>
            {invitation.organizationName} has invited you to join them on Nell. Choose a password to
            finish setting up.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {invitation.welcomeMessage ? (
            <p className="evidence italic">{invitation.welcomeMessage}</p>
          ) : null}

          <div className="rounded-lg border border-border bg-muted/40 p-4 text-sm">
            <p className="metric-label">Your account</p>
            <p className="mt-1 font-medium">{invitation.email}</p>
          </div>

          <AcceptInviteForm token={token} />

          <p className="text-xs leading-relaxed text-muted-foreground">
            Nell is a coaching support tool used by your coach. It is not a medical or therapeutic
            service and does not diagnose or treat any condition. What you record is visible to your
            coach.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
