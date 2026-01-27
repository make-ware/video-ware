'use client';

import React, { useState } from 'react';
import { TimelinePlayer } from './timeline-player';
import { TimelineView } from './timeline-view';
import { CollapsiblePanel } from '@/components/ui/collapsible-panel';
import { ClipBrowser } from '@/components/timeline/clip-browser';
import { TimelineRecommendationsPanelWrapper } from './timeline-recommendations-wrapper';
import { RenderDialog } from './render-dialog';
import { useTimeline } from '@/hooks/use-timeline';
import { useWorkspace } from '@/hooks/use-workspace';
import { Button } from '@/components/ui/button';
import {
  Save,
  Check,
  ArrowLeft,
  Download,
  Play,
  Library,
  Sparkles,
  X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';

export function TimelineEditorLayout() {
  const { timeline, hasUnsavedChanges, saveTimeline, isLoading } =
    useTimeline();
  const { currentWorkspace } = useWorkspace();
  const router = useRouter();
  const [renderDialogOpen, setRenderDialogOpen] = useState(false);
  const [activeMobilePanel, setActiveMobilePanel] = useState<
    'library' | 'recommendations' | null
  >(null);

  if (!timeline) return null;

  return (
    <div className="flex flex-col lg:flex-row h-[calc(100vh-4rem)] overflow-hidden bg-background relative">
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
          <ClipBrowser />
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
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (currentWorkspace) {
                  router.push(
                    `/ws/${currentWorkspace.id}/timelines/${timeline.id}/renders`
                  );
                }
              }}
              className="h-8 px-2 lg:px-3"
            >
              <Download className="h-4 w-4 lg:mr-2" />
              <span className="hidden lg:inline">Renders</span>
            </Button>
            <Button
              onClick={() => setRenderDialogOpen(true)}
              disabled={isLoading}
              variant="default"
              size="sm"
              className="h-8 px-2 lg:px-3 bg-primary hover:bg-primary/90"
            >
              <Play className="h-4 w-4 lg:mr-2 fill-current" />
              <span className="hidden lg:inline">Render</span>
            </Button>
            <Button
              onClick={saveTimeline}
              disabled={!hasUnsavedChanges || isLoading}
              variant={hasUnsavedChanges ? 'default' : 'outline'}
              size="sm"
              className="min-w-[70px] lg:min-w-[80px] h-8"
            >
              {isLoading ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              ) : hasUnsavedChanges ? (
                <>
                  <Save className="h-4 w-4 lg:mr-2" />
                  <span className="hidden lg:inline">Save</span>
                </>
              ) : (
                <>
                  <Check className="h-4 w-4 lg:mr-2" />
                  <span className="hidden lg:inline">Saved</span>
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Player Area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-auto p-1 lg:p-8 flex items-center justify-center min-h-0 bg-black/5">
            <div className="w-full max-w-4xl max-h-full aspect-video">
              <TimelinePlayer />
            </div>
          </div>

          {/* Timeline Area (Increased height for dual full-height views) */}
          <div className="h-[400px] lg:h-[420px] border-t bg-background p-3 lg:p-4 shrink-0 z-10 overflow-hidden">
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
          <Button
            variant={
              activeMobilePanel === 'recommendations' ? 'default' : 'ghost'
            }
            className="flex-1 gap-2 h-10"
            onClick={() =>
              setActiveMobilePanel(
                activeMobilePanel === 'recommendations'
                  ? null
                  : 'recommendations'
              )
            }
          >
            <Sparkles className="h-4 w-4" />
            Recs
          </Button>
        </div>
      </div>

      {/* Desktop Sidebar: Recommendations (Right) */}
      <CollapsiblePanel
        side="right"
        title="Recommendations"
        width="w-[420px]"
        className="hidden lg:flex"
      >
        <div className="h-full overflow-hidden flex flex-col">
          <div className="p-4 flex-1 overflow-y-auto">
            <TimelineRecommendationsPanelWrapper />
          </div>
        </div>
      </CollapsiblePanel>

      {/* Mobile Overlay Panels */}
      {activeMobilePanel && (
        <div className="lg:hidden fixed inset-0 z-50 bg-background flex flex-col pt-14 animate-in slide-in-from-bottom duration-300">
          <div className="h-14 border-b flex items-center justify-between px-4 shrink-0 bg-background">
            <h3 className="font-semibold uppercase tracking-wider text-xs">
              {activeMobilePanel === 'library'
                ? 'Clips Library'
                : 'Smart Recommendations'}
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
            {activeMobilePanel === 'library' ? (
              <div className="h-full flex flex-col overflow-hidden">
                <ClipBrowser />
              </div>
            ) : (
              <div className="p-4 h-full overflow-y-auto pb-20">
                <TimelineRecommendationsPanelWrapper />
              </div>
            )}
          </div>
        </div>
      )}
      <RenderDialog
        open={renderDialogOpen}
        onOpenChange={setRenderDialogOpen}
      />
    </div>
  );
}
