'use client';

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
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
  FileCode,
  Monitor,
  MoreVertical,
  Smartphone,
  Stethoscope,
  Type,
  Heading1,
  ChevronDown,
  Search,
  Layers,
  UnfoldVertical,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatTimecode } from '@/utils/format-clip-time';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  clampTimelineHeight,
  DEFAULT_TIMELINE_HEIGHT,
  maxTimelineHeight,
  MIN_TIMELINE_HEIGHT,
  nextSplitPreset,
  resolveInitialTimelineHeight,
  splitPresetHeight,
  TIMELINE_HEIGHT_KEY,
  type SplitPreset,
} from './timeline-split';
import { CaptionEditorModal } from '@/components/captions';
import { UniversalSearchModal } from './universal-search-modal';
import { InsertTimelineDialog } from './insert-timeline-dialog';
import { DoctorModal } from './doctor-modal';
import { useTimelineDoctor } from './use-timeline-doctor';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { MediaMutator } from '@project/shared/mutator';
import { TimelineOrientation, CaptionType } from '@project/shared';
import { generateFCPXML } from '@/utils/fcpxml';
import pb from '@/lib/pocketbase-client';
import { toast } from 'sonner';

/** The pane the splitter resizes, for `aria-controls`. */
const TIMELINE_PANE_ID = 'timeline-editor-timeline-pane';

/** Structure switches at lg, matching the `lg:` classes throughout. */
const COMPACT_QUERY = '(max-width: 1023px)';

export function TimelineEditorLayout() {
  const {
    timeline,
    hasUnsavedChanges,
    saveTimeline,
    isLoading,
    updateTimelineOrientation,
    addCaptionClip,
    tracks,
    selectedTrackId,
    currentTime,
  } = useTimeline();
  const { currentWorkspace } = useWorkspace();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [renderDialogOpen, setRenderDialogOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [insertTimelineOpen, setInsertTimelineOpen] = useState(false);
  const [doctorOpen, setDoctorOpen] = useState(false);
  const doctorReport = useTimelineDoctor();
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
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [splitPreset, setSplitPreset] = useState<SplitPreset>('balanced');
  const [isExporting, setIsExporting] = useState(false);

  // Resizable split between player and timeline. Height persists per browser.
  const [timelineHeight, setTimelineHeight] = useState(DEFAULT_TIMELINE_HEIGHT);
  const [columnHeight, setColumnHeight] = useState(0);
  const columnRef = useRef<HTMLDivElement | null>(null);
  const columnSizeRef = useRef({ width: 0, height: 0 });
  const resolvedRef = useRef(false);
  const isPortrait = timeline?.orientation === TimelineOrientation.PORTRAIT;

  // One ResizeObserver on the player+timeline column drives every height
  // decision. It covers window resize, orientationchange AND mobile browser
  // chrome showing/hiding — a one-shot read at mount left a stale, oversized
  // timeline behind after a rotation.
  useEffect(() => {
    const el = columnRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect || rect.height <= 0) return;
      columnSizeRef.current = { width: rect.width, height: rect.height };
      setColumnHeight(rect.height);

      if (!resolvedRef.current) {
        resolvedRef.current = true;
        const raw = window.localStorage.getItem(TIMELINE_HEIGHT_KEY);
        const parsed = raw === null ? null : parseInt(raw, 10);
        setTimelineHeight(
          resolveInitialTimelineHeight({
            stored: parsed !== null && Number.isNaN(parsed) ? null : parsed,
            columnHeight: rect.height,
            columnWidth: rect.width,
            isPortrait,
            isCompact: window.matchMedia(COMPACT_QUERY).matches,
          })
        );
        return;
      }
      setTimelineHeight((height) => clampTimelineHeight(height, rect.height));
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, [isPortrait]);

  const persistTimelineHeight = useCallback((height: number) => {
    window.localStorage.setItem(TIMELINE_HEIGHT_KEY, String(height));
  }, []);

  const handleSplitterPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const startY = e.clientY;
      const startHeight = timelineHeight;

      const onMove = (ev: PointerEvent) => {
        setTimelineHeight(
          clampTimelineHeight(
            startHeight + (startY - ev.clientY),
            columnSizeRef.current.height
          )
        );
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        setTimelineHeight((height) => {
          persistTimelineHeight(height);
          return height;
        });
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [persistTimelineHeight, timelineHeight]
  );

  // Keyboard equivalent of the drag (WAI-ARIA window splitter pattern). The
  // handle is a 10px target on desktop, so it was mouse-only until now.
  const handleSplitterKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const { height } = columnSizeRef.current;
      const step = e.key === 'PageUp' || e.key === 'PageDown' ? 64 : 16;
      let next: number | null = null;

      if (e.key === 'ArrowUp' || e.key === 'PageUp') {
        next = timelineHeight + step;
      } else if (e.key === 'ArrowDown' || e.key === 'PageDown') {
        next = timelineHeight - step;
      } else if (e.key === 'Home') {
        next = MIN_TIMELINE_HEIGHT;
      } else if (e.key === 'End') {
        next = maxTimelineHeight(height);
      }
      if (next === null) return;

      e.preventDefault();
      const clamped = clampTimelineHeight(next, height);
      setTimelineHeight(clamped);
      persistTimelineHeight(clamped);
    },
    [persistTimelineHeight, timelineHeight]
  );

  // Phones can't usefully negotiate a 10px handle, so the bottom bar cycles
  // between the derived balance, a preview-first and a timeline-first split.
  const cycleSplitPreset = useCallback(() => {
    setSplitPreset((current) => {
      const preset = nextSplitPreset(current);
      const { width, height } = columnSizeRef.current;
      const next = splitPresetHeight(preset, {
        columnHeight: height,
        columnWidth: width,
        isPortrait,
      });
      setTimelineHeight(next);
      persistTimelineHeight(next);
      return preset;
    });
  }, [isPortrait, persistTimelineHeight]);

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

  const handleOpenDoctor = useCallback(() => {
    setDoctorOpen(true);
  }, []);

  // Actionable doctor issues (errors + warnings) surfaced in the menu label;
  // info notes (ordinary gaps) are often intentional, so they don't count.
  const doctorIssueCount = doctorReport
    ? doctorReport.errors + doctorReport.warnings
    : 0;

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
      {
        id: 'doctor',
        label:
          doctorIssueCount > 0
            ? `Doctor (${doctorIssueCount} issue${doctorIssueCount === 1 ? '' : 's'})`
            : 'Doctor',
        icon: Stethoscope,
        separatorBefore: true,
        onSelect: handleOpenDoctor,
      },
    ],
    [
      hasUnsavedChanges,
      isLoading,
      isExporting,
      doctorIssueCount,
      saveTimeline,
      handleOpenRenderDialog,
      handleOpenRenders,
      handleExportFCPXML,
      handleOpenDoctor,
    ]
  );

  useRegisterPageMenu('file', fileMenuItems);

  // Mirrors addClip's target resolution in timeline-context, so a touch user
  // can see where the library's "+" will place a clip before tapping it —
  // that button, not drag-and-drop, is the phone's placement path.
  const insertTargetLabel = useMemo(() => {
    const target =
      tracks.find((t) => t.id === selectedTrackId) ??
      tracks.find((t) => t.layer === 0) ??
      tracks[0];
    if (!target) return 'Create a track before adding clips.';
    const name = target.name || `Layer ${target.layer}`;
    if (target.id !== selectedTrackId || target.isLocked) {
      return `Adding to the end of ${name} — tap a lane to insert at the playhead instead.`;
    }
    return `Inserting into ${name} at ${formatTimecode(currentTime)}`;
  }, [currentTime, selectedTrackId, tracks]);

  if (!timeline) return null;

  return (
    // 2.5625rem = NavigationBar's h-10 content + its border-b (the old 2.5rem
    // was a pixel short). dvh, not vh: mobile browser chrome would otherwise
    // push the bottom bar under the viewport.
    <div className="flex flex-col lg:flex-row h-[calc(100dvh-2.5625rem)] overflow-hidden bg-background relative">
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
        <div className="h-12 lg:h-14 border-b bg-background flex items-center justify-between gap-1 sm:gap-2 px-2 lg:px-4 shrink-0 z-20">
          {/* min-w-0 + flex-1: the title absorbs the slack instead of a fixed
              max-width fighting the right cluster for a phone's 375px. */}
          <div className="flex min-w-0 flex-1 items-center gap-1 sm:gap-2 lg:gap-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (currentWorkspace) {
                  router.push(`/ws/${currentWorkspace.id}/timelines`);
                }
              }}
              className="h-10 w-10 shrink-0 p-0 sm:h-8 sm:w-auto sm:px-2 lg:px-3"
              aria-label="Back to timelines"
            >
              <ArrowLeft className="h-4 w-4 lg:mr-2" />
              <span className="hidden lg:inline">Back</span>
            </Button>
            <h2 className="min-w-0 flex-1 truncate font-semibold text-sm lg:text-base lg:flex-none lg:max-w-[200px]">
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

          {/* Under sm these four controls sum past the viewport, and the
              orientation group was hidden outright — leaving no way to switch
              aspect at all. They collapse into one overflow menu instead. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="h-10 w-10 shrink-0 sm:hidden"
                aria-label="Editor actions"
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Orientation</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={
                  timeline.orientation === TimelineOrientation.PORTRAIT
                    ? TimelineOrientation.PORTRAIT
                    : TimelineOrientation.LANDSCAPE
                }
                onValueChange={(value) =>
                  updateTimelineOrientation(value as TimelineOrientation)
                }
              >
                <DropdownMenuRadioItem value={TimelineOrientation.LANDSCAPE}>
                  <Monitor className="h-4 w-4 mr-2" />
                  Landscape (16:9)
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value={TimelineOrientation.PORTRAIT}>
                  <Smartphone className="h-4 w-4 mr-2" />
                  Portrait (9:16)
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setSearchOpen(true)}>
                <Search className="h-4 w-4 mr-2" />
                Search clips
              </DropdownMenuItem>
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
              <DropdownMenuItem onClick={() => setInsertTimelineOpen(true)}>
                <Layers className="h-4 w-4 mr-2" />
                Insert Timeline
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="hidden sm:flex items-center gap-2">
            <div
              className="inline-flex items-center rounded-md border bg-background"
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
                aria-label="Landscape (16:9)"
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
                aria-label="Portrait (9:16)"
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
              aria-label="Search clips"
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
                  aria-label="Add captions or title screens"
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
              aria-label="Insert another timeline as a clip"
              onClick={() => setInsertTimelineOpen(true)}
            >
              <Layers className="h-4 w-4 lg:mr-2" />
              <span className="hidden lg:inline">Timeline</span>
            </Button>
          </div>
        </div>

        {/* Player Area. The column is the measured reference for the split. */}
        <div ref={columnRef} className="flex-1 flex flex-col overflow-hidden">
          {/* No aspect box here: TimelinePlayer sizes its own stage from the
              available height, so this is just a padded, non-scrolling frame. */}
          <div className="flex-1 min-h-0 overflow-hidden p-1 lg:p-4 bg-black/5">
            <TimelinePlayer />
          </div>

          {/* Splitter: drag to trade space between preview and timeline */}
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize timeline panel"
            aria-controls={TIMELINE_PANE_ID}
            aria-valuenow={timelineHeight}
            aria-valuemin={MIN_TIMELINE_HEIGHT}
            aria-valuemax={
              columnHeight ? maxTimelineHeight(columnHeight) : undefined
            }
            tabIndex={0}
            // 24px on phones (WCAG 2.5.8); desktop keeps the 10px handle.
            className="h-6 lg:h-2.5 shrink-0 border-t bg-background cursor-row-resize touch-none flex items-center justify-center group/splitter hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors z-10"
            onPointerDown={handleSplitterPointerDown}
            onKeyDown={handleSplitterKeyDown}
          >
            <div className="w-12 h-1.5 lg:w-10 lg:h-1 rounded-full bg-muted-foreground/30 group-hover/splitter:bg-muted-foreground/60 transition-colors" />
          </div>

          {/* Timeline Area (resizable via splitter above) */}
          <div
            id={TIMELINE_PANE_ID}
            className="border-t bg-background p-1 lg:p-3 shrink-0 z-10 overflow-hidden"
            style={{ height: timelineHeight }}
          >
            <TimelineView />
          </div>
        </div>

        {/* Mobile Nav Switcher */}
        <div className="lg:hidden h-11 border-t bg-background shrink-0 px-2 flex items-center gap-2">
          <Button
            variant={libraryOpen ? 'default' : 'ghost'}
            className="flex-1 gap-2 h-10"
            onClick={() => setLibraryOpen(true)}
          >
            <Library className="h-4 w-4" />
            Library
          </Button>
          {/* A 10px drag handle is a poor phone affordance, so the split is
              also reachable as three presets. */}
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 shrink-0"
            onClick={cycleSplitPreset}
            aria-label={`Split: ${splitPreset}. Switch to ${nextSplitPreset(splitPreset)}`}
            title="Cycle preview / timeline space"
          >
            <UnfoldVertical className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Mobile library. A Sheet, not a bespoke overlay: focus trap, scroll
          lock, Escape and aria-modal come for free, and it no longer covers
          the nav bar (which holds Save / Render / Doctor). */}
      <Sheet open={libraryOpen} onOpenChange={setLibraryOpen}>
        <SheetContent
          side="bottom"
          className="lg:hidden h-[85dvh] p-0 gap-0 flex flex-col"
        >
          <SheetHeader className="px-4 py-3 border-b shrink-0 text-left">
            <SheetTitle className="text-base">Clips Library</SheetTitle>
            <SheetDescription>{insertTargetLabel}</SheetDescription>
          </SheetHeader>
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <WorkspaceLibrary
              directoryFilter={directoryFilter}
              onDirectoryFilterChange={handleDirectoryFilterChange}
            />
          </div>
        </SheetContent>
      </Sheet>
      <UniversalSearchModal open={searchOpen} onOpenChange={setSearchOpen} />
      <InsertTimelineDialog
        open={insertTimelineOpen}
        onOpenChange={setInsertTimelineOpen}
      />
      <DoctorModal
        open={doctorOpen}
        onOpenChange={setDoctorOpen}
        report={doctorReport}
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
