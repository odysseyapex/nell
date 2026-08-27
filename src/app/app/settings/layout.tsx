import Link from 'next/link';

import { requireStaff } from '@/lib/auth/session';

const LINKS = [
  { href: '/app/settings', label: 'Overview' },
  { href: '/app/settings/framework', label: 'Framework' },
  { href: '/app/settings/exercises', label: 'Exercises' },
  { href: '/app/settings/reasons', label: 'Reasons' },
  { href: '/app/settings/method', label: 'Coaching method' },
  { href: '/app/settings/branding', label: 'Branding' },
  { href: '/app/settings/team', label: 'Team' },
  { href: '/app/settings/billing', label: 'Billing' },
];

export const dynamic = 'force-dynamic';

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  await requireStaff();

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>

      <div className="mt-6 grid gap-8 lg:grid-cols-[13rem_1fr]">
        <nav className="flex gap-1 overflow-x-auto lg:flex-col">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
