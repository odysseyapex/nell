import 'server-only';

import { formatRate } from '@/lib/metrics';
import type { EmailMessage } from './send';
import { appUrl, layout } from './send';

export function clientInvitationEmail(params: {
  organizationName: string;
  coachName: string;
  clientFirstName: string;
  token: string;
  welcomeMessage?: string | null;
}): EmailMessage {
  const url = appUrl(`/invite/${params.token}`);
  const welcome = params.welcomeMessage
    ? `<p style="background:#f1f5f9;padding:16px;border-radius:8px;font-style:italic;">${params.welcomeMessage}</p>`
    : '';

  return {
    to: '',
    subject: `${params.coachName} has invited you to ${params.organizationName}`,
    html: layout({
      organizationName: params.organizationName,
      heading: `Hi ${params.clientFirstName},`,
      body: `
        <p>${params.coachName} uses Nellvia to keep track of what you commit to between sessions — and, more usefully, what actually happens afterwards.</p>
        ${welcome}
        <p>It takes about thirty seconds a day. You record what you are committing to, and later you say what happened and what influenced it. Over time, Nellvia shows you the conditions under which things go well for you.</p>
        <p>This link is unique to you and expires in 14 days.</p>`,
      ctaLabel: 'Set up your account',
      ctaUrl: url,
    }),
    text: `Hi ${params.clientFirstName},

${params.coachName} has invited you to join ${params.organizationName} on Nellvia.

Nellvia takes about thirty seconds a day: record what you commit to, then say what actually happened and what influenced it.

Set up your account: ${url}

This link is unique to you and expires in 14 days.`,
  };
}

export function coachWelcomeEmail(params: {
  organizationName: string;
  firstName: string;
}): EmailMessage {
  const url = appUrl('/app/coach');
  return {
    to: '',
    subject: 'Your Nellvia workspace is ready',
    html: layout({
      organizationName: 'Nellvia',
      heading: `Welcome, ${params.firstName}`,
      body: `
        <p>${params.organizationName} is set up. Here is the shortest path to something useful:</p>
        <ol>
          <li>Build your framework — the questions you already ask, as structured steps.</li>
          <li>Create one exercise from it.</li>
          <li>Invite one client.</li>
        </ol>
        <p>Nellvia needs roughly two weeks of check-ins before patterns become readable. Until then it will tell you honestly that the sample is thin rather than inventing insight.</p>`,
      ctaLabel: 'Open Nellvia',
      ctaUrl: url,
    }),
    text: `Welcome, ${params.firstName}.

${params.organizationName} is set up on Nellvia.

1. Build your framework
2. Create one exercise
3. Invite one client

Open Nellvia: ${url}`,
  };
}

export function checkinReminderEmail(params: {
  organizationName: string;
  clientFirstName: string;
  commitmentText: string;
  commitmentDate: string;
}): EmailMessage {
  const url = appUrl('/app/client');
  return {
    to: '',
    subject: 'One quick check-in',
    html: layout({
      organizationName: params.organizationName,
      heading: `Hi ${params.clientFirstName},`,
      body: `
        <p>On ${params.commitmentDate} you committed to:</p>
        <p style="background:#f1f5f9;padding:16px;border-radius:8px;font-weight:600;">${params.commitmentText}</p>
        <p>What happened? There is no wrong answer here — the useful part is what influenced it.</p>`,
      ctaLabel: 'Check in',
      ctaUrl: url,
    }),
    text: `Hi ${params.clientFirstName},

On ${params.commitmentDate} you committed to: ${params.commitmentText}

What happened? Check in: ${url}`,
  };
}

export interface AttentionLine {
  clientName: string;
  headline: string;
  detail: string;
}

/**
 * The weekly coach email — the single most important retention surface in the
 * product. It answers one question: who needs you this week?
 */
export function weeklyCoachEmail(params: {
  organizationName: string;
  coachFirstName: string;
  lines: AttentionLine[];
  stableCount: number;
}): EmailMessage {
  const count = params.lines.length;
  const subject =
    count === 0
      ? 'No clients need your attention this week'
      : `${count} client${count === 1 ? '' : 's'} may need your attention`;

  const rows = params.lines
    .map(
      (line) => `
        <tr>
          <td style="padding:14px 0;border-bottom:1px solid #e2e8f0;">
            <div style="font-weight:600;color:#0f172a;">${line.clientName}</div>
            <div style="color:#334155;">${line.headline}</div>
            <div style="color:#64748b;font-size:14px;margin-top:2px;">${line.detail}</div>
          </td>
        </tr>`,
    )
    .join('');

  const body =
    count === 0
      ? `<p>Nothing is trending the wrong way across your roster. ${params.stableCount} client(s) are stable.</p>`
      : `<table style="width:100%;border-collapse:collapse;">${rows}</table>
         <p style="color:#64748b;font-size:14px;margin-top:20px;">${params.stableCount} other client(s) are stable.</p>`;

  return {
    to: '',
    subject,
    html: layout({
      organizationName: params.organizationName,
      heading: `Good morning, ${params.coachFirstName}`,
      body,
      ctaLabel: 'Open Nellvia',
      ctaUrl: appUrl('/app/coach'),
      footer: 'You receive this once a week. Manage it in your Nellvia settings.',
    }),
    text:
      count === 0
        ? `Good morning, ${params.coachFirstName}. No clients need your attention this week.`
        : `Good morning, ${params.coachFirstName}.\n\n${params.lines
            .map((l) => `${l.clientName}\n${l.headline}\n${l.detail}`)
            .join('\n\n')}\n\nOpen Nellvia: ${appUrl('/app/coach')}`,
  };
}

export function weeklyClientEmail(params: {
  organizationName: string;
  clientFirstName: string;
  followThrough7: number | null;
  completed: number;
  eligible: number;
  topReason: string | null;
}): EmailMessage {
  const reason = params.topReason
    ? `<p>When things went differently, the factor you recorded most often was <strong>${params.topReason}</strong>.</p>`
    : '';

  return {
    to: '',
    subject: 'Your week in Nellvia',
    html: layout({
      organizationName: params.organizationName,
      heading: `Hi ${params.clientFirstName},`,
      body: `
        <p>This week you completed <strong>${params.completed} of ${params.eligible}</strong> commitments (${formatRate(
          params.followThrough7,
        )}).</p>
        ${reason}
        <p>Not a score — just what the record shows. The interesting question is what made the difference.</p>`,
      ctaLabel: 'Open Nellvia',
      ctaUrl: appUrl('/app/client'),
    }),
    text: `Hi ${params.clientFirstName},

This week you completed ${params.completed} of ${params.eligible} commitments (${formatRate(params.followThrough7)}).${
      params.topReason ? `\n\nMost recorded factor: ${params.topReason}.` : ''
    }

Open Nellvia: ${appUrl('/app/client')}`,
  };
}
