import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { PocketBaseProvider } from '@/contexts/pocketbase-context';
import { AuthProvider } from '@/contexts/auth-context';
import { WorkspaceProvider } from '@/contexts/workspace-context';
import { UploadQueueProvider } from '@/contexts/upload-queue-context';
import { NavigationBar } from '@/components/layout/navigation-bar';
import { Toaster } from '@/components/ui/sonner';

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
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <PocketBaseProvider>
          <AuthProvider>
            <WorkspaceProvider>
              <UploadQueueProvider>
                <NavigationBar />
                <main className="min-h-screen pt-6">{children}</main>
                <Toaster />
              </UploadQueueProvider>
            </WorkspaceProvider>
          </AuthProvider>
        </PocketBaseProvider>
      </body>
    </html>
  );
}
