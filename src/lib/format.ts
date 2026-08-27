import type { Profile } from '@/lib/types';

/**
 * Display helpers shared by server and client components.
 *
 * Deliberately not server-only: the same name has to render in the coach's
 * table, the client's greeting and the weekly email, and three
 * implementations of "first last, or fall back to the email" is three places
 * for them to drift apart.
 */

type NameFields = Pick<Profile, 'first_name' | 'last_name' | 'email'>;

export function displayName(profile: NameFields): string {
  const name = `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim();
  return name.length > 0 ? name : profile.email;
}

export function initialsOf(profile: NameFields): string {
  const initials = `${profile.first_name?.[0] ?? ''}${profile.last_name?.[0] ?? ''}`.trim();
  return (initials || profile.email?.[0] || '?').toUpperCase();
}

/** "3 days ago", "Today", "Never" — for last-activity columns. */
export function describeDaysAgo(days: number | null): string {
  if (days === null) return 'Never';
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${days} days ago`;
}
