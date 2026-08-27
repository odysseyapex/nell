'use client';

import { useEffect } from 'react';

/**
 * Last-resort error boundary. Deliberately says nothing about what went wrong:
 * a stack trace on a screen that may be showing a client's reflections is not
 * a trade worth making.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;
    void import('@sentry/nextjs').then((Sentry) => Sentry.captureException(error));
  }, [error]);

  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', padding: '4rem 1.5rem', maxWidth: 480, margin: '0 auto' }}>
        <h1 style={{ fontSize: 20, fontWeight: 600 }}>Something went wrong</h1>
        <p style={{ marginTop: 12, color: '#475569', lineHeight: 1.6 }}>
          The error has been logged. Reload the page, and if it keeps happening let us know.
        </p>
        <a
          href="/app"
          style={{
            display: 'inline-block',
            marginTop: 24,
            background: '#0f172a',
            color: '#fff',
            padding: '10px 18px',
            borderRadius: 8,
            textDecoration: 'none',
          }}
        >
          Back to Nellvia
        </a>
      </body>
    </html>
  );
}
