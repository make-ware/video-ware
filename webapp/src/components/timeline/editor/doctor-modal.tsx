'use client';

import React, { useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useTimeline } from '@/hooks/use-timeline';
import { cn } from '@/lib/utils';
import {
  AlertTriangle,
  CircleCheck,
  Crosshair,
  Info,
  OctagonX,
} from 'lucide-react';
import type { DoctorFinding, DoctorLevel } from '@project/shared';
import type { TimelineDoctorReport } from './use-timeline-doctor';

const LEVEL_STYLE: Record<
  DoctorLevel,
  { icon: React.ComponentType<{ className?: string }>; className: string }
> = {
  error: { icon: OctagonX, className: 'text-destructive' },
  warning: { icon: AlertTriangle, className: 'text-amber-500' },
  info: { icon: Info, className: 'text-muted-foreground' },
};

interface DoctorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  report: TimelineDoctorReport | null;
}

/**
 * File-menu doctor: the same health checks as `vw timeline doctor`, listed
 * with a locate action that selects the affected clip and moves the playhead
 * to the finding.
 */
export function DoctorModal({ open, onOpenChange, report }: DoctorModalProps) {
  const { setSelectedClipId, setCurrentTime } = useTimeline();

  const handleLocate = useCallback(
    (finding: DoctorFinding) => {
      if (finding.clipIds.length > 0) {
        setSelectedClipId(finding.clipIds[0]);
      }
      if (finding.start !== undefined) {
        setCurrentTime(Math.max(0, finding.start));
      }
      onOpenChange(false);
    },
    [setSelectedClipId, setCurrentTime, onOpenChange]
  );

  const findings = report?.findings ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Timeline Doctor</DialogTitle>
          <DialogDescription>
            {report && findings.length > 0
              ? `${report.errors} error${report.errors === 1 ? '' : 's'}, ` +
                `${report.warnings} warning${report.warnings === 1 ? '' : 's'}, ` +
                `${report.infos} note${report.infos === 1 ? '' : 's'}`
              : 'Health checks over the placed clips — the same checks as the CLI doctor.'}
          </DialogDescription>
        </DialogHeader>

        {findings.length === 0 ? (
          <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-4 text-sm text-emerald-600 dark:text-emerald-400">
            <CircleCheck className="h-4 w-4 shrink-0" />
            No issues found — the timeline looks healthy.
          </div>
        ) : (
          <div className="max-h-[50vh] space-y-1.5 overflow-y-auto pr-1">
            {findings.map((finding, index) => {
              const { icon: LevelIcon, className } = LEVEL_STYLE[finding.level];
              const canLocate =
                finding.clipIds.length > 0 || finding.start !== undefined;
              return (
                <div
                  key={`${finding.code}-${index}`}
                  className="flex items-start gap-2 rounded-md border bg-muted/30 px-2.5 py-2"
                >
                  <LevelIcon
                    className={cn('mt-0.5 h-4 w-4 shrink-0', className)}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <Badge
                        variant="outline"
                        className="h-4 px-1 text-[10px] font-mono"
                      >
                        {finding.code}
                      </Badge>
                      {finding.layer !== undefined && (
                        <span className="text-[10px] text-muted-foreground">
                          track {finding.layer}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 break-words text-xs text-foreground/90">
                      {finding.message}
                    </p>
                  </div>
                  {canLocate && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 text-muted-foreground"
                      title="Select the clip and move the playhead there"
                      onClick={() => handleLocate(finding)}
                    >
                      <Crosshair className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
