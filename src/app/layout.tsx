import type { Metadata, Viewport } from 'next';

import { Toaster } from '@/components/ui/sonner';
import { AnalyticsProvider } from '@/components/shared/analytics-provider';

import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Nell — know which clients need you before they tell you',
    template: '%s · Nell',
  },
  description:
    'Nell captures what clients commit to, compares it with what actually happens, identifies the patterns behind missed commitments, and shows coaches where intervention matters.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Nell', statusBarStyle: 'default' },
  icons: { icon: '/icon.svg', apple: '/icon.svg' },
};

export const viewport: Viewport = {
  themeColor: '#1f2937',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <AnalyticsProvider>{children}</AnalyticsProvider>
        <Toaster />
      </body>
    </html>
  );
}
