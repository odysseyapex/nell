import 'server-only';

import { Resend } from 'resend';

import { env, serverEnv } from '@/lib/env';

/**
 * Transactional email.
 *
 * Nell sends few emails on purpose: an invitation, a nudge when a check-in is
 * outstanding, and the weekly attention summary that is the coach's main
 * reason to come back. Anything beyond that trains people to ignore us.
 *
 * When RESEND_API_KEY is unset, sends are logged and reported as skipped
 * rather than throwing, so local development and the demo never break on a
 * missing key.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export type SendResult = { sent: boolean; skipped?: boolean; error?: string };

export async function sendEmail(message: EmailMessage): Promise<SendResult> {
  const { RESEND_API_KEY, RESEND_FROM_EMAIL } = serverEnv();

  if (!RESEND_API_KEY) {
    console.info(`[email] skipped (no RESEND_API_KEY): "${message.subject}" → ${message.to}`);
    return { sent: false, skipped: true };
  }

  try {
    const resend = new Resend(RESEND_API_KEY);
    const { error } = await resend.emails.send({
      from: RESEND_FROM_EMAIL,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });

    if (error) return { sent: false, error: error.message };
    return { sent: true };
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown error';
    console.error('[email] send failed', detail);
    return { sent: false, error: detail };
  }
}

const BRAND_STYLES = `
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: #1f2937; line-height: 1.6; max-width: 560px; margin: 0 auto; padding: 32px 24px;
`;

export function layout(options: {
  organizationName: string;
  heading: string;
  body: string;
  ctaLabel?: string;
  ctaUrl?: string;
  footer?: string;
}): string {
  const cta =
    options.ctaLabel && options.ctaUrl
      ? `<p style="margin:32px 0;">
           <a href="${options.ctaUrl}"
              style="background:#0f172a;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;display:inline-block;font-weight:600;">
             ${options.ctaLabel}
           </a>
         </p>`
      : '';

  return `<!doctype html><html><body style="margin:0;background:#f8fafc;">
    <div style="${BRAND_STYLES}">
      <p style="font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;margin:0 0 24px;">
        ${options.organizationName}
      </p>
      <h1 style="font-size:22px;margin:0 0 16px;color:#0f172a;">${options.heading}</h1>
      ${options.body}
      ${cta}
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:32px 0 16px;" />
      <p style="font-size:12px;color:#94a3b8;margin:0;">
        ${options.footer ?? 'Sent by Nell, the follow-through intelligence used by your coach.'}
      </p>
    </div>
  </body></html>`;
}

export function appUrl(path: string): string {
  return `${env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')}${path}`;
}
