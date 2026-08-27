import { redirect } from 'next/navigation';

import { homePathFor, requireSession } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

/** /app is a router, not a page: send each role to the surface built for them. */
export default async function AppIndexPage() {
  const session = await requireSession();
  redirect(homePathFor(session.profile.role));
}
