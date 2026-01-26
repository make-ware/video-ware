'use client';

import React from 'react';
import Link from 'next/link';
import {
  Menu,
  LogOut,
  Settings,
  Upload,
  Film,
  Activity,
  Clapperboard,
  Building2,
  BarChart,
} from 'lucide-react';
import Image from 'next/image';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspace } from '@/hooks/use-workspace';
import { useIsMobile } from '@/hooks/use-mobile';
import { WorkspaceSelector } from '@/components/workspace';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { ModeToggle } from '@/components/mode-toggle';
import { cn } from '@/lib/utils';

interface NavigationBarProps {
  className?: string;
}

export function NavigationBar({ className }: NavigationBarProps) {
  const { user, isAuthenticated, logout, isLoading } = useAuth();
  const { currentWorkspace } = useWorkspace();
  const isMobile = useIsMobile();

  const workspaceId = currentWorkspace?.id;
  const wsPrefix = workspaceId ? `/ws/${workspaceId}` : '';

  // Helper function to get user initials for avatar fallback
  const getUserInitials = (name?: string, email?: string) => {
    if (name) {
      return name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
    }
    if (email) {
      return email[0].toUpperCase();
    }
    return 'U';
  };

  const handleLogout = () => {
    logout();
  };

  // Navigation links for authenticated users
  // Only show workspace-specific links if a workspace is selected
  const authenticatedLinks = [
    ...(workspaceId
      ? [
          { href: `${wsPrefix}/uploads`, label: 'Uploads', icon: Upload },
          { href: `${wsPrefix}/tasks`, label: 'Tasks', icon: Activity },
          { href: `${wsPrefix}/media`, label: 'Media', icon: Film },
          {
            href: `${wsPrefix}/timelines`,
            label: 'Timelines',
            icon: Clapperboard,
          },
          {
            href: `${wsPrefix}/metrics`,
            label: 'Metrics',
            icon: BarChart,
          },
        ]
      : []),
    { href: '/workspaces', label: 'Workspaces', icon: Building2 },
    { href: '/profile', label: 'Profile', icon: Settings },
  ];

  // Navigation links for unauthenticated users
  const unauthenticatedLinks = [
    { href: '/login', label: 'Login' },
    { href: '/signup', label: 'Sign Up' },
  ];

  return (
    <header
      className={cn(
        'border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60',
        className
      )}
    >
      <div className="container flex h-14 items-center">
        {/* Logo/Brand */}
        <div className="mr-4 flex pl-4">
          <Link href="/" className="mr-6 flex items-center space-x-2">
            <Image
              src="/video-ware.png"
              alt="VideoWare Logo"
              className="text-primary"
              width={36}
              height={36}
            />
            <span className="font-bold text-xl">Videoware</span>
          </Link>
        </div>

        {/* Desktop Navigation */}
        <div className="flex flex-1 items-center justify-between space-x-2 md:justify-end">
          <div className="w-full flex-1 md:w-auto md:flex-none">
            {/* Workspace Selector for authenticated users */}
            {isAuthenticated && !isMobile && (
              <div className="flex items-center">
                <WorkspaceSelector />
              </div>
            )}
          </div>

          {/* Desktop Auth Navigation */}
          {!isMobile && (
            <nav className="flex items-center gap-2">
              <ModeToggle />
              {isLoading ? (
                <div className="h-8 w-20 animate-pulse bg-muted rounded" />
              ) : isAuthenticated ? (
                <>
                  {/* Prominent Upload and Media links - only if workspace selected */}
                  {workspaceId && (
                    <>
                      <Button variant="ghost" asChild>
                        <Link
                          href={`${wsPrefix}/uploads`}
                          className="flex items-center gap-2"
                        >
                          <Upload className="h-4 w-4" />
                          <span>Upload</span>
                        </Link>
                      </Button>
                      <Button variant="ghost" asChild>
                        <Link
                          href={`${wsPrefix}/media`}
                          className="flex items-center gap-2"
                        >
                          <Film className="h-4 w-4" />
                          <span>Media</span>
                        </Link>
                      </Button>
                      <Button variant="ghost" asChild>
                        <Link
                          href={`${wsPrefix}/timelines`}
                          className="flex items-center gap-2"
                        >
                          <Clapperboard className="h-4 w-4" />
                          <span>Timelines</span>
                        </Link>
                      </Button>
                    </>
                  )}
                  <div className="flex items-center gap-4">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          className="relative h-8 w-8 rounded-full"
                        >
                          <Avatar className="h-8 w-8">
                            <AvatarImage
                              src={user?.avatar}
                              alt={user?.name || user?.email}
                            />
                            <AvatarFallback>
                              {getUserInitials(user?.name, user?.email)}
                            </AvatarFallback>
                          </Avatar>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        className="w-56"
                        align="end"
                        forceMount
                      >
                        <DropdownMenuLabel className="font-normal">
                          <div className="flex flex-col space-y-1">
                            <p className="text-sm font-medium leading-none">
                              {user?.name || 'User'}
                            </p>
                            <p className="text-xs leading-none text-muted-foreground">
                              {user?.email}
                            </p>
                          </div>
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        {authenticatedLinks.map((link) => (
                          <DropdownMenuItem key={link.href} asChild>
                            <Link
                              href={link.href}
                              className="flex items-center"
                            >
                              <link.icon className="mr-2 h-4 w-4" />
                              <span>{link.label}</span>
                            </Link>
                          </DropdownMenuItem>
                        ))}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={handleLogout}>
                          <LogOut className="mr-2 h-4 w-4" />
                          <span>Log out</span>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </>
              ) : (
                <div className="flex items-center gap-2">
                  <Button variant="ghost" asChild>
                    <Link href="/login">Login</Link>
                  </Button>
                  <Button asChild>
                    <Link href="/signup">Sign Up</Link>
                  </Button>
                </div>
              )}
            </nav>
          )}

          {/* Mobile Navigation */}
          {isMobile && (
            <Sheet>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  className="mr-2 px-0 text-base hover:bg-transparent focus-visible:bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 md:hidden"
                >
                  <Menu className="h-5 w-5" />
                  <span className="sr-only">Toggle Menu</span>
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="pr-0">
                <SheetHeader>
                  <SheetTitle>Navigation</SheetTitle>
                </SheetHeader>
                <div className="flex flex-col space-y-4 p-4">
                  <div className="flex items-center justify-between pb-4 border-b">
                    <span className="font-medium">Theme</span>
                    <ModeToggle />
                  </div>
                  {isAuthenticated ? (
                    <>
                      <div className="flex items-center space-x-4 pb-4 border-b">
                        <Avatar className="h-12 w-12">
                          <AvatarImage
                            src={user?.avatar}
                            alt={user?.name || user?.email}
                          />
                          <AvatarFallback>
                            {getUserInitials(user?.name, user?.email)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex flex-col">
                          <p className="text-sm font-medium">
                            {user?.name || 'User'}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {user?.email}
                          </p>
                        </div>
                      </div>
                      {/* Workspace Selector for mobile */}
                      <div className="pb-4 border-b">
                        <WorkspaceSelector />
                      </div>
                      {authenticatedLinks.map((link) => (
                        <Button
                          key={link.href}
                          variant="ghost"
                          className="justify-start"
                          asChild
                        >
                          <Link href={link.href}>
                            <link.icon className="mr-2 h-4 w-4" />
                            {link.label}
                          </Link>
                        </Button>
                      ))}
                      <Button
                        variant="ghost"
                        className="justify-start"
                        onClick={handleLogout}
                      >
                        <LogOut className="mr-2 h-4 w-4" />
                        Log out
                      </Button>
                    </>
                  ) : (
                    <>
                      {unauthenticatedLinks.map((link) => (
                        <Button
                          key={link.href}
                          variant="ghost"
                          className="justify-start"
                          asChild
                        >
                          <Link href={link.href}>{link.label}</Link>
                        </Button>
                      ))}
                    </>
                  )}
                </div>
              </SheetContent>
            </Sheet>
          )}
        </div>
      </div>
    </header>
  );
}
