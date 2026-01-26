'use client';

import { useState, useEffect } from 'react';
import {
  Media,
  Expanded,
  MediaRelations,
  LabelJob,
  Task,
} from '@project/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { MediaService } from '@/services/media';
import pb from '@/lib/pocketbase-client';

interface MediaLabelJobsProps {
  media: Expanded<Media, MediaRelations>;
  onUpdate: () => void;
}

const JOB_TYPES = [
  { id: 'object', label: 'Object Detection' },
  { id: 'shot', label: 'Shot & Label Detection' },
  { id: 'face', label: 'Face Detection' },
  { id: 'person', label: 'Person Detection' },
  { id: 'speech', label: 'Speech Transcription' },
];

export function MediaLabelJobs({ media, onUpdate }: MediaLabelJobsProps) {
  const [regenerating, setRegenerating] = useState<Record<string, boolean>>({});
  const [jobs, setJobs] = useState<Record<string, Expanded<LabelJob, { TaskRef?: Task }>>>({});
  const [loading, setLoading] = useState(true);

  const fetchJobs = async () => {
    try {
      const mediaService = new MediaService(pb);
      // We need to cast the result because getLabelJobs returns LabelJob[]
      // but strictly speaking, the mutator returns expanded objects.
      // However, the return type in MediaService is LabelJob[].
      // We can assert it.
      const fetchedJobs = await mediaService.getLabelJobs(media.id) as unknown as Expanded<LabelJob, { TaskRef?: Task }>[];

      const jobsMap: Record<string, Expanded<LabelJob, { TaskRef?: Task }>> = {};
      fetchedJobs.forEach((job) => {
        jobsMap[job.jobType] = job;
      });
      setJobs(jobsMap);
    } catch (error) {
      console.error('Failed to fetch label jobs:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
  }, [media.id]);

  const handleRegenerate = async (type: string) => {
    try {
      setRegenerating((prev) => ({ ...prev, [type]: true }));
      const mediaService = new MediaService(pb);

      await mediaService.regenerateLabel(media.id, type);

      toast.success(`Regeneration started for ${type}`);
      // Wait a bit or fetch immediately? Task creation is fast.
      await fetchJobs();
      onUpdate();
    } catch (error) {
      console.error(`Failed to regenerate ${type}:`, error);
      toast.error(`Failed to regenerate ${type}`);
    } finally {
      setRegenerating((prev) => ({ ...prev, [type]: false }));
    }
  };

  const renderJobRow = (typeId: string, label: string) => {
    const job = jobs[typeId];
    const task = job?.expand?.TaskRef as Task | undefined;

    let status = 'Not Run';
    if (task) {
      status = task.status;
    }

    let countDisplay = '-';
    // Access result safely
    const taskResult = task?.result as Record<string, any> | undefined;

    if (taskResult && taskResult.summary) {
      const summary = taskResult.summary;
      if (typeId === 'object' && typeof summary.objectCount === 'number') {
        countDisplay = `${summary.objectCount} objects`;
      } else if (typeId === 'shot' && typeof summary.labelCount === 'number') {
        countDisplay = `${summary.labelCount} labels`;
      }
    }

    // Determine if we should disable the button (if running/queued)
    // Actually user might want to force regenerate?
    // But usually duplicate jobs are avoided.
    // Let's allow regeneration unless it's strictly running?
    // The user requirement "ensure that we can re-generate a specific job"
    // Usually implies being able to trigger it.
    // If it's already queued/running, maybe show "Processing".

    const isProcessing = status === 'queued' || status === 'running';

    return (
      <TableRow key={typeId}>
        <TableCell className="font-medium">{label}</TableCell>
        <TableCell>
          <span
            className={
              status === 'success'
                ? 'text-green-600'
                : status === 'failed'
                ? 'text-red-600'
                : isProcessing
                ? 'text-yellow-600'
                : 'text-muted-foreground'
            }
          >
            {status.toUpperCase()}
          </span>
        </TableCell>
        <TableCell>{countDisplay}</TableCell>
        <TableCell className="text-right">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleRegenerate(typeId)}
            disabled={regenerating[typeId] || isProcessing}
          >
            <RefreshCw
              className={`h-4 w-4 mr-2 ${regenerating[typeId] || isProcessing ? 'animate-spin' : ''}`}
            />
            {isProcessing ? 'Processing' : 'Regenerate'}
          </Button>
        </TableCell>
      </TableRow>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Label Jobs</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Job Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Count</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {JOB_TYPES.map((type) => renderJobRow(type.id, type.label))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
