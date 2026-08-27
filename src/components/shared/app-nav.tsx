'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  CalendarCheck,
  ChevronDown,
  History,
  LayoutDashboard,
  Lightbulb,
  ListChecks,
  Settings,
  Sun,
  Users,
} from 'lucide-react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { signOut } from '@/app/(auth)/actions';
import { displayName, initialsOf } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Organization, Profile } from '@/lib/types';

interface NavItem {
  href: string;
  label: string;
  icon: typeof Sun;
}

const CLIENT_NAV: NavItem[] = [
  { href: '/app/client', label: 'Today', icon: Sun },
  { href: '/app/client/commitments', label: 'Commitments', icon: ListChecks },
  { href: '/app/client/insights', label: 'Insights', icon: Lightbulb },
  { href: '/app/client/history', label: 'History', icon: History },
];

const COACH_NAV: NavItem[] = [
  { href: '/app/coach', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/app/coach/clients', label: 'Clients', icon: Users },
  { href: '/app/coach/experiments', label: 'Experiments', icon: CalendarCheck },
  { href: '/app/settings', label: 'Settings', icon: Settings },
];

function isActive(pathname: string, href: string): boolean {
  // Both roles have an index route that must not stay lit on every subpage.
  if (href === '/app/coach' || href === '/app/client') return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Navigation adapts to the role rather than showing a client the coach's
 * world greyed out. Clients get a bottom bar on mobile — the check-in has to
 * be reachable with a thumb, in a hurry.
 */
export function AppNav({ profile, organization }: { profile: Profile; organization: Organization }) {
  const pathname = usePathname();
  const isClient = profile.role === 'client';
  const items = isClient ? CLIENT_NAV : COACH_NAV;
  const initials = initialsOf(profile);

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-6">
            <Link href={isClient ? '/app/client' : '/app/coach'} className="flex items-center gap-2">
              {organization.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={organization.logo_url} alt="" className="h-7 w-7 rounded object-cover" />
              ) : (
                <span
                  className="flex h-7 w-7 items-center justify-center rounded text-xs font-semibold"
                  style={{ background: 'var(--brand)', color: 'var(--brand-foreground)' }}
                >
                  {organization.name[0]?.toUpperCase() ?? 'N'}
                </span>
              )}
              <span className="truncate text-sm font-semibold tracking-tight">{organization.name}</span>
            </Link>

            {/* Desktop navigation. Clients navigate from the bottom bar. */}
            <nav className="hidden items-center gap-1 md:flex">
              {items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    isActive(pathname, item.href)
                      ? 'bg-muted text-foreground'
                      : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                  )}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="gap-2 px-2">
                <Avatar>
                  {profile.avatar_url ? <AvatarImage src={profile.avatar_url} alt="" /> : null}
                  <AvatarFallback>{initials}</AvatarFallback>
                </Avatar>
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                {displayName(profile)}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href={isClient ? '/app/client/settings' : '/app/settings'}>Settings</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <form action={signOut} className="w-full">
                  <button type="submit" className="w-full text-left">
                    Sign out
                  </button>
                </form>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* Mobile bottom bar. Large targets: this gets used one-handed, standing up. */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur md:hidden">
        <div className="mx-auto flex max-w-lg items-stretch">
          {items.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex flex-1 flex-col items-center gap-1 py-3 text-[11px] font-medium transition-colors',
                  active ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                <item.icon className={cn('h-5 w-5', active && 'text-[var(--brand)]')} />
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
