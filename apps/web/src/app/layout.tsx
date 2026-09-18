import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import type { ReactNode } from 'react';
import { Providers } from '@/components/providers';
import { SiteFooter, SiteHeader } from '@/components/site-chrome';
import { config } from '@/lib/config';
import './globals.css';

// Self-hosted at build time by next/font: no request to Google from the visitor's browser.
const sans = Geist({ subsets: ['latin'], variable: '--font-geist', display: 'swap' });
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono', display: 'swap' });

const description =
  'Timelock-encrypted sealed voting on Arc. Votes stay sealed until the drand round closes, then anyone can reveal them.';

export const metadata: Metadata = {
  metadataBase: new URL(`${config.siteUrl}/`),
  title: { default: 'ArcSeal: sealed voting on Arc', template: '%s · ArcSeal' },
  description,
  applicationName: 'ArcSeal',
  openGraph: { type: 'website', siteName: 'ArcSeal', title: 'ArcSeal: sealed voting on Arc', description },
};

export const viewport: Viewport = { themeColor: '#ffffff', colorScheme: 'light' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-dvh overflow-x-clip antialiased">
        <Providers>
          <SiteHeader />
          <main id="main">{children}</main>
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
