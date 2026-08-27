import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DEMO_USERS } from '@/lib/demo/dataset';
import { isDemoMode } from '@/lib/demo/supabase';
import { DEMO_COOKIE } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Demo workspace' };
export const dynamic = 'force-dynamic';

/**
 * Development harness: pick whose eyes to see Nell through.
 *
 * Only reachable when NELL_DEMO_MODE=1 — otherwise this route does not exist.
 * There is no password because there is no auth: the cookie names a demo
 * profile, and every query below it is scoped exactly as Row Level Security
 * would scope it.
 */
export default async function DemoPage() {
  if (!isDemoMode()) notFound();

  async function signInAs(formData: FormData) {
    'use server';
    const authUserId = String(formData.get('authUserId') ?? '');
    if (!DEMO_USERS.some((user) => user.authUserId === authUserId)) redirect('/demo');

    const store = await cookies();
    store.set(DEMO_COOKIE, authUserId, { httpOnly: true, sameSite: 'lax', path: '/' });
    redirect(authUserId === 'auth-coach-claire' ? '/app/coach' : '/app/today');
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Demo workspace</h1>
        <Badge variant="watch">No database</Badge>
      </div>
      <p className="mt-3 text-muted-foreground">
        Claire Coaching, with 90 days of generated history for four clients. The metrics, patterns,
        alerts and risk levels you see are produced by the real engines reading this data — only
        the storage is in memory.
      </p>

      <div className="mt-8 space-y-3">
        {DEMO_USERS.map((user) => (
          <Card key={user.authUserId}>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <p className="font-medium">{user.name}</p>
                <p className="text-sm text-muted-foreground">{user.role}</p>
              </div>
              <form action={signInAs}>
                <input type="hidden" name="authUserId" value={user.authUserId} />
                <Button type="submit" variant={user.authUserId === 'auth-coach-claire' ? 'default' : 'outline'}>
                  View as {user.name.split(' ')[0]}
                </Button>
              </form>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="evidence mt-8">
        Start with Claire to see the coach dashboard, then switch to a client to see the same data
        from their side — and to confirm they cannot reach the coach&apos;s screens.
      </div>

      <p className="mt-6 text-sm">
        <Link href="/" className="text-muted-foreground underline underline-offset-4">
          Back to the marketing page
        </Link>
      </p>
    </div>
  );
}
