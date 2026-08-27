/**
 * Server and edge instrumentation.
 *
 * Sentry is initialised here rather than in a config file so that a deployment
 * without a DSN simply runs uninstrumented instead of failing to boot.
 */
export async function register() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  const Sentry = await import('@sentry/nextjs');

  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    // Nell handles behavioural data about real people. Nothing that could
    // carry a client's own words is sent to an error tracker.
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
      }
      return event;
    },
  });
}

export async function onRequestError(...args: unknown[]) {
  if (!process.env.SENTRY_DSN) return;
  const Sentry = await import('@sentry/nextjs');
  const capture = (Sentry as unknown as { captureRequestError?: (...a: unknown[]) => void })
    .captureRequestError;
  capture?.(...args);
}
