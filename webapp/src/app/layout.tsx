import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { QueryProvider } from '@/contexts/query-provider';
import { PocketBaseProvider } from '@/contexts/pocketbase-context';
import { AuthProvider } from '@/contexts/auth-context';
import { WorkspaceProvider } from '@/contexts/workspace-context';
import { UploadQueueProvider } from '@/contexts/upload-queue-context';
import { PageMenuProvider } from '@/contexts/page-menu-context';
import { NavigationBar } from '@/components/layout/navigation-bar';
import { Toaster } from '@/components/ui/sonner';
import { ThemeProvider } from '@/components/theme-provider';
import {
  resolvePublicPocketbaseUrl,
  runtimeConfigScript,
} from '@/lib/runtime-config';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'VideoWare - Web-Based Video Editor',
  description:
    'Create, edit, and manage your videos with our powerful web-based video editor',
};

// The runtime config below is read from `process.env` per request. Without
// this the layout is prerendered at build time and the emitted script would
// carry the *build*-time value, which is the bug we are fixing. Cost is
// negligible: every page in the app is already 'use client' and auth-gated,
// so the prerendered shells this gives up carry no page-specific content.
export const dynamic = 'force-dynamic';

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const pocketbaseUrl = resolvePublicPocketbaseUrl(process.env);

  return (
    <html lang="en" suppressHydrationWarning>
      {/* Inline classic script setting the runtime config during HTML parse.
          React hoists Next's own bundle <script async> tags ABOVE anything the
          layout emits, so this is NOT the first child of <head> and cannot be
          made so from App Router — an async chunk could in principle execute
          first and construct the PocketBase singleton with the stale URL.
          `PocketBaseProvider` closes that window by reconciling `pb.baseURL`
          before any consumer renders; see syncBaseUrl in lib/pocketbase-client.
          Emitted only when configured, so deployments that set nothing ship
          byte-identical HTML to before. */}
      {pocketbaseUrl && (
        <head>
          <script
            dangerouslySetInnerHTML={{
              __html: runtimeConfigScript({ pocketbaseUrl }),
            }}
          />
        </head>
      )}
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <QueryProvider>
          <PocketBaseProvider>
            <AuthProvider>
              <WorkspaceProvider>
                <UploadQueueProvider>
                  <ThemeProvider
                    attribute="class"
                    defaultTheme="system"
                    enableSystem
                    disableTransitionOnChange
                  >
                    <PageMenuProvider>
                      <NavigationBar />
                      {/* 2.5625rem = NavigationBar's h-10 content + its
                          border-b. `min-h-screen` here made the body taller
                          than the viewport by exactly the nav's height, so
                          every full-height page scrolled ~41px. dvh so mobile
                          browser chrome shrinks the page instead of
                          overflowing it. */}
                      <main className="min-h-[calc(100dvh-2.5625rem)]">
                        {children}
                      </main>
                      <Toaster />
                    </PageMenuProvider>
                  </ThemeProvider>
                </UploadQueueProvider>
              </WorkspaceProvider>
            </AuthProvider>
          </PocketBaseProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
