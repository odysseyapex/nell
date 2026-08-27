/**
 * Server actions are origin-checked by Next.js: a POST whose Host header is
 * not an allowed origin is rejected with a 500. That is the right default,
 * since it is what stops a third-party page invoking an action on behalf of a
 * signed-in user.
 *
 * It also means a deployment reached through any host Next does not know about
 * — a tunnel, a preview domain, a custom domain — has a working UI where every
 * button silently fails. So the allowed list is configurable.
 *
 * The wildcard for tunnel domains is granted only in the demo harness. In a
 * real deployment the list is exactly what has been configured, and nothing
 * else.
 */
const configuredOrigins = (process.env.SERVER_ACTION_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const appHost = (() => {
  try {
    return process.env.NEXT_PUBLIC_APP_URL ? new URL(process.env.NEXT_PUBLIC_APP_URL).host : null;
  } catch {
    return null;
  }
})();

const demoOrigins =
  process.env.NELL_DEMO_MODE === '1' ? ['*.trycloudflare.com', '*.ngrok-free.app', '*.loca.lt'] : [];

const allowedOrigins = [
  ...new Set(['localhost:3000', appHost, ...configuredOrigins, ...demoOrigins].filter(Boolean)),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: { bodySizeLimit: '2mb', allowedOrigins },
  },
  eslint: { ignoreDuringBuilds: false },
};

export default nextConfig;
