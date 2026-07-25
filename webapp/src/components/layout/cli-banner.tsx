'use client';

import { useCallback, useState, useSyncExternalStore } from 'react';
import { Terminal, Copy, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';

const STORAGE_KEY = 'vw-cli-banner-dismissed';
const BREW_INSTALL = 'brew tap makeware/tap && brew install vw';
const RELEASES_URL = 'https://github.com/make-ware/video-ware/releases';

// Dismissal lives in localStorage, exposed to React as an external store so we
// can read it without a set-state-in-effect and without a hydration mismatch
// (useSyncExternalStore uses the server snapshot during hydration, then swaps
// in the client value). `snapshot` is cached so getSnapshot stays referentially
// stable until dismissal actually changes.
const dismissListeners = new Set<() => void>();
let snapshot: boolean | null = null;

function getSnapshot(): boolean {
  if (snapshot === null) {
    snapshot = window.localStorage.getItem(STORAGE_KEY) === '1';
  }
  return snapshot;
}

function getServerSnapshot(): boolean {
  return false;
}

function subscribe(onChange: () => void): () => void {
  dismissListeners.add(onChange);
  return () => dismissListeners.delete(onChange);
}

function markDismissed(): void {
  window.localStorage.setItem(STORAGE_KEY, '1');
  snapshot = true;
  dismissListeners.forEach((listener) => listener());
}

/**
 * A dismissible promo banner nudging users toward the `vw` command-line tool.
 * Rendered at the top of the upload and workspace-selection pages.
 */
export function CliBanner({ className }: { className?: string }) {
  const dismissed = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot
  );
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard
      .writeText(BREW_INSTALL)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {
        // Clipboard unavailable (e.g. insecure context) — no-op.
      });
  }, []);

  if (dismissed) return null;

  return (
    <div
      className={cn(
        // Hidden on mobile — the CLI is a desktop workflow.
        'hidden items-center gap-4 rounded-lg border border-primary/20 bg-primary/5 px-4 py-2.5 sm:flex',
        className
      )}
    >
      <p className="flex min-w-0 flex-1 items-center gap-2.5 text-sm text-foreground">
        <Terminal className="size-4 shrink-0 text-primary" />
        <span>
          Get the{' '}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
            vw
          </code>{' '}
          CLI — edit from your terminal, or let AI agents edit for you.
        </span>
      </p>

      <div className="flex shrink-0 items-center gap-3">
        <button
          type="button"
          onClick={handleCopy}
          className="group flex items-center gap-2 rounded-md border bg-background px-3 py-1.5 font-mono text-xs text-foreground transition-colors hover:bg-accent"
          aria-label="Copy install command"
        >
          <span className="text-muted-foreground select-none">$</span>
          <span>{BREW_INSTALL}</span>
          {copied ? (
            <Check className="size-3.5 text-primary" />
          ) : (
            <Copy className="size-3.5 text-muted-foreground group-hover:text-foreground" />
          )}
        </button>
        <a
          href={RELEASES_URL}
          target="_blank"
          rel="noreferrer"
          className="hidden text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline lg:inline"
        >
          Other options
        </a>
      </div>

      <button
        type="button"
        onClick={markDismissed}
        aria-label="Dismiss"
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
