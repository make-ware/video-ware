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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
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
