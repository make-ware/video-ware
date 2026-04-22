'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Menu,
  LogOut,
  Building2,
  Settings,
  Upload,
  Film,
  Clapperboard,
  Activity,
  BarChart,
  FileCode,
  HelpCircle,
  Info,
  User,
} from 'lucide-react';
import Image from 'next/image';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspace } from '@/hooks/use-workspace';
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
  SheetClose,
} from '@/components/ui/sheet';
import { AppMenubar } from '@/components/layout/app-menubar';
import { ModeToggle } from '@/components/mode-toggle';
import { cn } from '@/lib/utils';

interface NavigationBarProps {
  className?: string;
}

interface MobileNavLinkProps {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  isActive?: boolean;
  disabled?: boolean;
}

function MobileNavLink({
  href,
  icon: Icon,
  label,
  isActive,
  disabled,
}: MobileNavLinkProps) {
  if (disabled) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground/60 cursor-not-allowed">
        <Icon className="h-4 w-4" />
        {label}
      </div>
    );
  }
  return (
    <SheetClose asChild>
      <Link
        href={href}
        className={cn(
          'flex items-center gap-2 rounded-sm px-3 py-2 text-sm transition-colors',
          'hover:bg-accent hover:text-accent-foreground',
          isActive
            ? 'bg-accent text-accent-foreground font-medium'
            : 'text-foreground'
        )}
        aria-current={isActive ? 'page' : undefined}
      >
        <Icon className="h-4 w-4" />
        {label}
      </Link>
    </SheetClose>
  );
}

function MobileSectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pt-3 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  );
}

export function NavigationBar({ className }: NavigationBarProps) {
  const { user, isAuthenticated, logout, isLoading } = useAuth();
  const { currentWorkspace } = useWorkspace();
  const pathname = usePathname();

  const workspaceId = currentWorkspace?.id;
  const wsPrefix = workspaceId ? `/ws/${workspaceId}` : '';
  const hasWorkspace = !!workspaceId;

  const isTimelineEditor =
    /\/ws\/[^/]+\/timelines\/[^/]+/.test(pathname) &&
    !pathname.endsWith('/timelines');

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
        {isAuthenticated && <AppMenubar className="hidden lg:flex" />}

        {/* Spacer + Right-side controls */}
        <div className="flex flex-1 items-center justify-end gap-2">
          {isLoading ? (
            <div className="h-7 w-16 animate-pulse bg-muted rounded" />
          ) : isAuthenticated ? (
            <>
              {/* Desktop Avatar */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    className="relative h-7 w-7 rounded-full hidden lg:inline-flex"
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

              {/* Mobile/Tablet Hamburger */}
              <Sheet>
                <SheetTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="px-2 lg:hidden"
                    aria-label="Open navigation menu"
                  >
                    <Menu className="h-5 w-5" />
                  </Button>
                </SheetTrigger>
                <SheetContent
                  side="right"
                  className="w-[300px] p-0 flex flex-col"
                >
                  <SheetHeader className="px-4 py-3 border-b">
                    <SheetTitle className="text-base">Navigation</SheetTitle>
                  </SheetHeader>

                  <div className="flex-1 overflow-y-auto">
                    {/* User */}
                    <div className="flex items-center gap-3 px-4 py-3 border-b">
                      <Avatar className="h-10 w-10">
                        <AvatarImage
                          src={user?.avatar}
                          alt={user?.name || user?.email}
                        />
                        <AvatarFallback>
                          {getUserInitials(user?.name, user?.email)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex flex-col min-w-0">
                        <p className="text-sm font-medium truncate">
                          {user?.name || 'User'}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {user?.email}
                        </p>
                      </div>
                    </div>

                    {/* Workspace */}
                    <div className="px-2 py-2">
                      <MobileSectionLabel>Workspace</MobileSectionLabel>
                      <div className="px-3 py-2">
                        <WorkspaceSelector />
                      </div>
                    </div>

                    {/* Workspace shortcuts */}
                    {hasWorkspace && (
                      <div className="px-2 pb-2 border-t pt-2">
                        <MobileSectionLabel>Navigate</MobileSectionLabel>
                        <MobileNavLink
                          href={`${wsPrefix}/uploads`}
                          icon={Upload}
                          label="Upload"
                          isActive={pathname.startsWith(`${wsPrefix}/uploads`)}
                        />
                        <MobileNavLink
                          href={`${wsPrefix}/media`}
                          icon={Film}
                          label="Media"
                          isActive={pathname.startsWith(`${wsPrefix}/media`)}
                        />
                        <MobileNavLink
                          href={`${wsPrefix}/timelines`}
                          icon={Clapperboard}
                          label="Timelines"
                          isActive={pathname.startsWith(
                            `${wsPrefix}/timelines`
                          )}
                        />
                      </div>
                    )}

                    {/* File */}
                    {hasWorkspace && (
                      <div className="px-2 pb-2 border-t pt-2">
                        <MobileSectionLabel>File</MobileSectionLabel>
                        <MobileNavLink
                          href="#"
                          icon={FileCode}
                          label="Export FCPXML"
                          disabled={!isTimelineEditor}
                        />
                      </div>
                    )}

                    {/* Settings */}
                    {hasWorkspace && (
                      <div className="px-2 pb-2 border-t pt-2">
                        <MobileSectionLabel>Settings</MobileSectionLabel>
                        <MobileNavLink
                          href={`${wsPrefix}/tasks`}
                          icon={Activity}
                          label="Tasks"
                          isActive={pathname.startsWith(`${wsPrefix}/tasks`)}
                        />
                        <MobileNavLink
                          href={`${wsPrefix}/metrics`}
                          icon={BarChart}
                          label="Metrics"
                          isActive={pathname.startsWith(`${wsPrefix}/metrics`)}
                        />
                      </div>
                    )}

                    {/* Help */}
                    <div className="px-2 pb-2 border-t pt-2">
                      <MobileSectionLabel>Help</MobileSectionLabel>
                      <MobileNavLink
                        href="#"
                        icon={HelpCircle}
                        label="Documentation"
                        disabled
                      />
                      <MobileNavLink
                        href="#"
                        icon={Info}
                        label="About VideoWare"
                        disabled
                      />
                    </div>

                    {/* Account */}
                    <div className="px-2 pb-2 border-t pt-2">
                      <MobileSectionLabel>Account</MobileSectionLabel>
                      <MobileNavLink
                        href="/profile"
                        icon={User}
                        label="Profile"
                        isActive={pathname === '/profile'}
                      />
                      <MobileNavLink
                        href="/workspaces"
                        icon={Building2}
                        label="Manage Workspaces"
                        isActive={pathname === '/workspaces'}
                      />
                      <div className="flex items-center justify-between rounded-sm px-3 py-2 text-sm">
                        <span>Theme</span>
                        <ModeToggle />
                      </div>
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="border-t p-2">
                    <Button
                      variant="ghost"
                      className="w-full justify-start"
                      onClick={handleLogout}
                    >
                      <LogOut className="mr-2 h-4 w-4" />
                      Log out
                    </Button>
                  </div>
                </SheetContent>
              </Sheet>
            </>
          ) : (
            <>
              <nav className="hidden lg:flex items-center gap-2">
                <Button variant="ghost" size="sm" asChild>
                  <Link href="/login">Login</Link>
                </Button>
                <Button size="sm" asChild>
                  <Link href="/signup">Sign Up</Link>
                </Button>
              </nav>

              {/* Mobile/Tablet Hamburger (unauth) */}
              <Sheet>
                <SheetTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="px-2 lg:hidden"
                    aria-label="Open navigation menu"
                  >
                    <Menu className="h-5 w-5" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="right" className="w-[280px]">
                  <SheetHeader>
                    <SheetTitle>Navigation</SheetTitle>
                  </SheetHeader>
                  <div className="flex flex-col gap-1 p-2">
                    <div className="flex items-center justify-between rounded-sm px-3 py-2 text-sm">
                      <span>Theme</span>
                      <ModeToggle />
                    </div>
                    <SheetClose asChild>
                      <Button variant="ghost" className="justify-start" asChild>
                        <Link href="/login">Login</Link>
                      </Button>
                    </SheetClose>
                    <SheetClose asChild>
                      <Button variant="ghost" className="justify-start" asChild>
                        <Link href="/signup">Sign Up</Link>
                      </Button>
                    </SheetClose>
                  </div>
                </SheetContent>
              </Sheet>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
