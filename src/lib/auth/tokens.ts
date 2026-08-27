import { createHash, randomBytes } from 'node:crypto';

/**
 * Invitation tokens.
 *
 * The raw token exists in exactly one place: the invitation email. Only its
 * SHA-256 hash is persisted, so a database leak yields nothing redeemable, and
 * a token can be verified without ever being stored.
 *
 * This lives outside the server-actions module because a 'use server' file may
 * only export async functions.
 */

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generateInviteToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}
