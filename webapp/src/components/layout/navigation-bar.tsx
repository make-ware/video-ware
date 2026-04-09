'use client';

import React from 'react';
import Link from 'next/link';
import { Menu, LogOut, Building2, Settings } from 'lucide-react';
import Image from 'next/image';
import { useAuth } from '@/hooks/use-auth';
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
import { AppMenubar } from '@/components/layout/app-menubar';
import { ModeToggle } from '@/components/mode-toggle';
import { cn } from '@/lib/utils';

interface NavigationBarProps {
  className?: string;
}

export function NavigationBar({ className }: NavigationBarProps) {
  const { user, isAuthenticated, logout, isLoading } = useAuth();
  const isMobile = useIsMobile();

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

  // Mobile navigation links
  const mobileLinks = [
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
      <div className="container flex h-10 items-center">
        {/* Logo/Brand */}
        <div className="mr-3 flex pl-4">
          <Link href="/" className="mr-4 flex items-center space-x-1.5">
            <Image
              src="/video-ware.png"
              alt="VideoWare Logo"
              className="text-primary"
              width={24}
              height={24}
            />
            <span className="font-bold text-sm">Videoware</span>
          </Link>
        </div>

        {/* Desktop Menubar */}
        {!isMobile && isAuthenticated && (
          <AppMenubar className="hidden lg:flex" />
        )}

        {/* Spacer + Right-side controls */}
        <div className="flex flex-1 items-center justify-end gap-2">
          {/* Desktop Auth */}
          {!isMobile && (
            <nav className="flex items-center gap-1">
              {isLoading ? (
                <div className="h-7 w-16 animate-pulse bg-muted rounded" />
              ) : isAuthenticated ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      className="relative h-7 w-7 rounded-full"
                    >
                      <Avatar className="h-7 w-7">
                        <AvatarImage
                          src={user?.avatar}
                          alt={user?.name || user?.email}
                        />
                        <AvatarFallback className="text-xs">
                          {getUserInitials(user?.name, user?.email)}
                        </AvatarFallback>
                      </Avatar>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-56" align="end" forceMount>
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
                    <DropdownMenuItem asChild>
                      <Link href="/profile" className="flex items-center">
                        <Settings className="mr-2 h-4 w-4" />
                        <span>Profile</span>
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link href="/workspaces" className="flex items-center">
                        <Building2 className="mr-2 h-4 w-4" />
                        <span>Workspaces</span>
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleLogout}>
                      <LogOut className="mr-2 h-4 w-4" />
                      <span>Log out</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" asChild>
                    <Link href="/login">Login</Link>
                  </Button>
                  <Button size="sm" asChild>
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
                      {mobileLinks.map((link) => (
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
