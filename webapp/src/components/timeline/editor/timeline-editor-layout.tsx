'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { TimelinePlayer } from './timeline-player';
import { TimelineView } from './timeline-view';
import { CollapsiblePanel } from '@/components/ui/collapsible-panel';
import { WorkspaceLibrary } from '@/components/library';
import { RenderDialog } from './render-dialog';
import { useTimeline } from '@/hooks/use-timeline';
import { useWorkspace } from '@/hooks/use-workspace';
import { useRegisterPageMenu } from '@/hooks/use-page-menu';
import type { PageMenuItem } from '@/contexts/page-menu-context';
import { Button } from '@/components/ui/button';
import {
  Save,
  Check,
  ArrowLeft,
  Download,
  Play,
  Library,
  X,
  FileCode,
  Monitor,
  Smartphone,
  Type,
  Heading1,
  ChevronDown,
  Search,
  Layers,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CaptionEditorModal } from '@/components/captions';
import { UniversalSearchModal } from './universal-search-modal';
import { InsertTimelineDialog } from './insert-timeline-dialog';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { MediaMutator } from '@project/shared/mutator';
import { TimelineOrientation, CaptionType } from '@project/shared';
import { generateFCPXML } from '@/utils/fcpxml';
import pb from '@/lib/pocketbase-client';
import { toast } from 'sonner';

const TIMELINE_HEIGHT_KEY = 'timeline-editor:timeline-height';
const DEFAULT_TIMELINE_HEIGHT = 320;
const MIN_TIMELINE_HEIGHT = 180;

function clampTimelineHeight(height: number) {
  const max =
    typeof window !== 'undefined'
      ? Math.round(window.innerHeight * 0.7)
      : DEFAULT_TIMELINE_HEIGHT;
  return Math.min(Math.max(height, MIN_TIMELINE_HEIGHT), max);
}

export function TimelineEditorLayout() {
  const {
    timeline,
    hasUnsavedChanges,
    saveTimeline,
    isLoading,
    updateTimelineOrientation,
    addCaptionClip,
  } = useTimeline();
  const { currentWorkspace } = useWorkspace();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [renderDialogOpen, setRenderDialogOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [insertTimelineOpen, setInsertTimelineOpen] = useState(false);
  const [captionEditorType, setCaptionEditorType] =
    useState<CaptionType | null>(null);

  // Cmd/Ctrl+K opens the universal clip search (window-level so it works
  // regardless of focus, including when the timeline grid has focus).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Directory filter synced to ?dir= query param
  const directoryFilter = searchParams.get('dir') ?? null;

  const handleDirectoryFilterChange = useCallback(
    (filter: string | null) => {
      const url = filter
        ? `${pathname}?dir=${encodeURIComponent(filter)}`
        : pathname;
      window.history.replaceState(null, '', url);
    },
    [pathname]
  );
  const [activeMobilePanel, setActiveMobilePanel] = useState<'library' | null>(
    null
  );
  const [isExporting, setIsExporting] = useState(false);

  // Resizable split between player and timeline. Height persists per browser.
  const [timelineHeight, setTimelineHeight] = useState(DEFAULT_TIMELINE_HEIGHT);

  useEffect(() => {
    const stored = window.localStorage.getItem(TIMELINE_HEIGHT_KEY);
    if (stored) {
      const parsed = parseInt(stored, 10);
      if (!Number.isNaN(parsed)) {
        setTimelineHeight(clampTimelineHeight(parsed));
      }
    }
  }, []);

  const handleSplitterPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const startY = e.clientY;
      const startHeight = timelineHeight;

      const onMove = (ev: PointerEvent) => {
        setTimelineHeight(
          clampTimelineHeight(startHeight + (startY - ev.clientY))
        );
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        setTimelineHeight((height) => {
          window.localStorage.setItem(TIMELINE_HEIGHT_KEY, String(height));
          return height;
        });
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [timelineHeight]
  );

  const handleExportFCPXML = useCallback(async () => {
    if (!timeline) return;

    try {
      setIsExporting(true);
      // Collect unique media IDs
      const mediaIds = new Set<string>();
      timeline.clips.forEach((clip) => {
        if (clip.MediaRef) mediaIds.add(clip.MediaRef);
      });

      if (mediaIds.size === 0) {
        toast.error('No media in timeline to export');
        setIsExporting(false);
        return;
      }

      // Fetch media records
      const mediaMutator = new MediaMutator(pb);
      // Construct filter string: (id="id1" || id="id2" ...)
      const filter = `(${Array.from(mediaIds)
        .map((id) => `id="${id}"`)
        .join('||')})`;

      // Fetch all media (up to 1000 for now)
      const mediaList = await mediaMutator.getList(1, 1000, filter);
      const mediaMap = new Map();
      mediaList.items.forEach((media) => mediaMap.set(media.id, media));

      // Generate XML
      const xml = generateFCPXML(timeline, mediaMap);

      // Download
      const blob = new Blob([xml], { type: 'text/xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${timeline.name || 'timeline'}.fcpxml`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success('FCPXML exported successfully');
    } catch (error) {
      console.error('Export failed:', error);
      toast.error('Failed to export FCPXML');
    } finally {
      setIsExporting(false);
    }
  }, [timeline]);

  const handleOpenRenders = useCallback(() => {
    if (currentWorkspace && timeline) {
      router.push(
        `/ws/${currentWorkspace.id}/timelines/${timeline.id}/renders`
      );
    }
  }, [currentWorkspace, router, timeline]);

  const handleOpenRenderDialog = useCallback(() => {
    setRenderDialogOpen(true);
  }, []);

  // Contribute the timeline's output actions to the nav bar File menu.
  const fileMenuItems = useMemo<PageMenuItem[]>(
    () => [
      {
        id: 'save',
        label: hasUnsavedChanges ? 'Save' : 'Saved',
        icon: hasUnsavedChanges ? Save : Check,
        disabled: !hasUnsavedChanges || isLoading,
        onSelect: saveTimeline,
      },
      {
        id: 'render',
        label: 'Render',
        icon: Play,
        disabled: isLoading,
        separatorBefore: true,
        onSelect: handleOpenRenderDialog,
      },
      {
        id: 'renders',
        label: 'Renders',
        icon: Download,
        onSelect: handleOpenRenders,
      },
      {
        id: 'export-xml',
        label: 'Export XML',
        icon: FileCode,
        disabled: isExporting,
        separatorBefore: true,
        onSelect: handleExportFCPXML,
      },
    ],
    [
      hasUnsavedChanges,
      isLoading,
      isExporting,
      saveTimeline,
      handleOpenRenderDialog,
      handleOpenRenders,
      handleExportFCPXML,
    ]
  );

  useRegisterPageMenu('file', fileMenuItems);

  if (!timeline) return null;

  return (
    <div className="flex flex-col lg:flex-row h-[calc(100vh-2.5rem)] overflow-hidden bg-background relative">
      {/* 
          Desktop Sidebar: Assets (Left)
      */}
      <CollapsiblePanel
        side="left"
        title="Media Assets"
        width="w-[420px]"
        className="hidden lg:flex"
      >
        <div className="h-full flex flex-col overflow-hidden">
          <WorkspaceLibrary
            directoryFilter={directoryFilter}
            onDirectoryFilterChange={handleDirectoryFilterChange}
          />
        </div>
      </CollapsiblePanel>

      {/* Main Content Area: Player & Timeline */}
      <div className="flex-1 flex flex-col min-w-0 bg-muted/20 overflow-hidden">
        {/* Toolbar */}
        <div className="h-14 border-b bg-background flex items-center justify-between px-4 shrink-0 z-20">
          <div className="flex items-center gap-2 lg:gap-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (currentWorkspace) {
                  router.push(`/ws/${currentWorkspace.id}/timelines`);
                }
              }}
              className="h-8 px-2 lg:px-3"
            >
              <ArrowLeft className="h-4 w-4 lg:mr-2" />
              <span className="hidden lg:inline">Back</span>
            </Button>
            <h2 className="font-semibold truncate max-w-[120px] lg:max-w-[200px] text-sm lg:text-base">
              {timeline.name}
            </h2>
            {hasUnsavedChanges && (
              <span
                className="text-muted-foreground shrink-0 text-sm lg:text-base"
                title="Unsaved changes"
                aria-label="Unsaved changes"
              >
                *
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <div
              className="hidden sm:inline-flex items-center rounded-md border bg-background"
              role="group"
              aria-label="Timeline orientation"
            >
              <Button
                variant={
                  timeline.orientation !== TimelineOrientation.PORTRAIT
                    ? 'default'
                    : 'ghost'
                }
                size="sm"
                onClick={() =>
                  updateTimelineOrientation(TimelineOrientation.LANDSCAPE)
                }
                className="h-8 rounded-r-none px-2"
                title="Landscape (16:9)"
                aria-pressed={
                  timeline.orientation !== TimelineOrientation.PORTRAIT
                }
              >
                <Monitor className="h-4 w-4" />
              </Button>
              <Button
                variant={
                  timeline.orientation === TimelineOrientation.PORTRAIT
                    ? 'default'
                    : 'ghost'
                }
                size="sm"
                onClick={() =>
                  updateTimelineOrientation(TimelineOrientation.PORTRAIT)
                }
                className="h-8 rounded-l-none px-2"
                title="Portrait (9:16)"
                aria-pressed={
                  timeline.orientation === TimelineOrientation.PORTRAIT
                }
              >
                <Smartphone className="h-4 w-4" />
              </Button>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-2 lg:px-3"
              title="Search clips (⌘K)"
              onClick={() => setSearchOpen(true)}
            >
              <Search className="h-4 w-4 lg:mr-2" />
              <span className="hidden lg:inline">Search</span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 px-2 lg:px-3"
                  title="Add captions or title screens"
                >
                  <Type className="h-4 w-4 lg:mr-2" />
                  <span className="hidden lg:inline">Text</span>
                  <ChevronDown className="h-3 w-3 ml-1 hidden lg:inline" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => setCaptionEditorType(CaptionType.CAPTION)}
                >
                  <Type className="h-4 w-4 mr-2" />
                  Add Caption
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setCaptionEditorType(CaptionType.TITLE)}
                >
                  <Heading1 className="h-4 w-4 mr-2" />
                  Add Title Screen
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-2 lg:px-3"
              title="Insert another timeline as a clip"
              onClick={() => setInsertTimelineOpen(true)}
            >
              <Layers className="h-4 w-4 lg:mr-2" />
              <span className="hidden lg:inline">Timeline</span>
            </Button>
          </div>
        </div>

        {/* Player Area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-auto p-2 lg:p-4 flex items-center justify-center min-h-0 bg-black/5">
            <div
              className={`w-full max-h-full ${
                timeline.orientation === TimelineOrientation.PORTRAIT
                  ? 'max-w-xs aspect-[9/16]'
                  : 'max-w-5xl aspect-video'
              }`}
            >
              <TimelinePlayer />
            </div>
          </div>

          {/* Splitter: drag to trade space between preview and timeline */}
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize timeline panel"
            className="h-2.5 shrink-0 border-t bg-background cursor-row-resize touch-none flex items-center justify-center group/splitter hover:bg-muted/60 transition-colors z-10"
            onPointerDown={handleSplitterPointerDown}
          >
            <div className="w-10 h-1 rounded-full bg-muted-foreground/30 group-hover/splitter:bg-muted-foreground/60 transition-colors" />
          </div>

          {/* Timeline Area (resizable via splitter above) */}
          <div
            className="border-t bg-background p-2 lg:p-3 shrink-0 z-10 overflow-hidden"
            style={{ height: timelineHeight }}
          >
            <TimelineView />
          </div>
        </div>

        {/* Mobile Nav Switcher */}
        <div className="lg:hidden h-14 border-t bg-background shrink-0 px-4 flex items-center gap-4">
          <Button
            variant={activeMobilePanel === 'library' ? 'default' : 'ghost'}
            className="flex-1 gap-2 h-10"
            onClick={() =>
              setActiveMobilePanel(
                activeMobilePanel === 'library' ? null : 'library'
              )
            }
          >
            <Library className="h-4 w-4" />
            Library
          </Button>
        </div>
      </div>

      {/* Mobile Overlay Panels */}
      {activeMobilePanel && (
        <div className="lg:hidden fixed inset-0 z-50 bg-background flex flex-col pt-14 animate-in slide-in-from-bottom duration-300">
          <div className="h-14 border-b flex items-center justify-between px-4 shrink-0 bg-background">
            <h3 className="font-semibold uppercase tracking-wider text-xs">
              Clips Library
            </h3>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setActiveMobilePanel(null)}
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
          <div className="flex-1 overflow-hidden">
            <div className="h-full flex flex-col overflow-hidden">
              <WorkspaceLibrary
                directoryFilter={directoryFilter}
                onDirectoryFilterChange={handleDirectoryFilterChange}
              />
            </div>
          </div>
        </div>
      )}
      <UniversalSearchModal open={searchOpen} onOpenChange={setSearchOpen} />
      <InsertTimelineDialog
        open={insertTimelineOpen}
        onOpenChange={setInsertTimelineOpen}
      />
      <RenderDialog
        open={renderDialogOpen}
        onOpenChange={setRenderDialogOpen}
      />
      <CaptionEditorModal
        open={captionEditorType !== null}
        onOpenChange={(open) => {
          if (!open) setCaptionEditorType(null);
        }}
        workspaceId={timeline.WorkspaceRef}
        defaultType={captionEditorType ?? CaptionType.CAPTION}
        onSaved={async (caption) => {
          await addCaptionClip(caption.id, caption.duration);
        }}
      />
    </div>
  );
}
