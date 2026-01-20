'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspace } from '@/hooks/use-workspace';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import Image from 'next/image';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { ArrowRight, Upload, Scissors, Server } from 'lucide-react';

export default function Home() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { currentWorkspace, isLoading: workspaceLoading } = useWorkspace();
  const router = useRouter();

  useEffect(() => {
    if (!authLoading && !workspaceLoading && isAuthenticated) {
      if (currentWorkspace) {
        router.push(`/ws/${currentWorkspace.id}/media`);
      } else {
        router.push('/workspaces');
      }
    }
  }, [
    authLoading,
    workspaceLoading,
    isAuthenticated,
    currentWorkspace,
    router,
  ]);

  if (authLoading || (isAuthenticated && workspaceLoading)) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (isAuthenticated) {
    // Will redirect in useEffect, show loading state
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return <UnauthenticatedView />;
}

function UnauthenticatedView() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted/20">
      {/* Hero Section */}
      <div className="container mx-auto px-4 py-16 max-w-6xl">
        <div className="text-center mb-16">
          <h1 className="flex flex-wrap items-center justify-center gap-2 text-5xl md:text-6xl font-bold text-foreground mb-6">
            <span className="flex items-center gap-2">
              <Image
                src="/video-ware.png"
                alt="VideoWare Logo"
                className="text-primary"
                width={64}
                height={64}
              />
              <span> - Videoware</span>
            </span>
            <span className="w-full text-center text-primary">
              Web-Based Video Editor
            </span>
          </h1>
          <p className="text-xl md:text-2xl text-muted-foreground mb-8 max-w-3xl mx-auto">
            Create, edit, and manage your videos with our powerful self-hostable
            web-based video editor. Upload your media, trim clips, and export
            professional videos—all in your browser. Choose between local or
            cloud processing to fit your needs.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/login">
              <Button variant="outline" size="lg" className="text-lg px-8 py-6">
                Sign In
              </Button>
            </Link>
            <Link href="/signup">
              <Button size="lg" className="text-lg px-8 py-6">
                Get Started
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
          </div>
        </div>

        {/* Features Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-16">
          <FeatureCard
            icon={<Upload className="h-8 w-8" />}
            title="Easy Upload"
            description="Drag and drop or browse to upload your video files. Supports multiple formats with automatic processing."
          />
          <FeatureCard
            icon={<Scissors className="h-8 w-8" />}
            title="Video Editing"
            description="Trim, cut, and edit your videos with intuitive tools. Create professional content without leaving your browser."
          />
          <FeatureCard
            icon={<Server className="h-8 w-8" />}
            title="Self-Hostable"
            description="Deploy VideoWare on your own infrastructure for complete data sovereignty. Full control over your video processing pipeline and storage."
          />
        </div>
      </div>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Card className="hover:shadow-lg transition-shadow">
      <CardHeader>
        <div className="flex items-center gap-3 mb-2">
          <div className="text-primary">{icon}</div>
          <CardTitle className="text-xl">{title}</CardTitle>
        </div>
        <CardDescription className="text-base leading-relaxed">
          {description}
        </CardDescription>
      </CardHeader>
    </Card>
  );
}
