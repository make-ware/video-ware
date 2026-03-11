'use client';

import { useState, useEffect } from 'react';
import { Media, Expanded, LabelJob, Task } from '@project/shared';
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
  media: Media;
  onUpdate: () => void;
}

const JOB_TYPES = [
  { id: 'object', label: 'Object Detection' },
  { id: 'shot', label: 'Shot & Label Detection' },
  { id: 'face', label: 'Face Detection' },
  { id: 'person', label: 'Person Detection' },
  { id: 'speech', label: 'Speech Transcription' },
];

// Map job type IDs to detect labels step types
const JOB_TYPE_TO_STEP: Record<string, string> = {
  object: 'labels:object_tracking',
  shot: 'labels:label_detection',
  face: 'labels:face_detection',
  person: 'labels:person_detection',
  speech: 'labels:speech_transcription',
};

// Map job type IDs to payload config keys
const JOB_TYPE_TO_CONFIG: Record<string, string> = {
  object: 'detectObjects',
  shot: 'detectLabels',
  face: 'detectFaces',
  person: 'detectPersons',
  speech: 'detectSpeech',
};

function getCountFromStepOutput(
  typeId: string,
  output: Record<string, unknown> | undefined
): string {
  if (!output?.counts) return '-';
  const counts = output.counts as Record<string, number>;

  switch (typeId) {
    case 'object':
      if (typeof counts.objectCount === 'number')
        return `${counts.objectCount} objects`;
      if (typeof counts.labelObjectCount === 'number')
        return `${counts.labelObjectCount} objects`;
      return '-';
    case 'shot':
      if (
        typeof counts.segmentLabelCount === 'number' &&
        typeof counts.shotCount === 'number'
      )
        return `${counts.segmentLabelCount} labels, ${counts.shotCount} shots`;
      if (typeof counts.labelCount === 'number')
        return `${counts.labelCount} labels`;
      return '-';
    case 'face':
      if (typeof counts.faceCount === 'number')
        return `${counts.faceCount} faces`;
      if (typeof counts.labelFaceCount === 'number')
        return `${counts.labelFaceCount} faces`;
      return '-';
    case 'person':
      if (typeof counts.personCount === 'number')
        return `${counts.personCount} persons`;
      if (typeof counts.labelPersonCount === 'number')
        return `${counts.labelPersonCount} persons`;
      return '-';
    case 'speech':
      if (typeof counts.wordCount === 'number')
        return `${counts.wordCount} words`;
      if (typeof counts.labelSpeechCount === 'number')
        return `${counts.labelSpeechCount} words`;
      return '-';
    default:
      return '-';
  }
}

function mapStepStatus(stepStatus: string): string {
  switch (stepStatus) {
    case 'completed':
      return 'success';
    case 'failed':
      return 'failed';
    case 'running':
      return 'running';
    case 'pending':
      return 'queued';
    default:
      return stepStatus;
  }
}

export function MediaLabelJobs({ media, onUpdate }: MediaLabelJobsProps) {
  const [regenerating, setRegenerating] = useState<Record<string, boolean>>({});
  const [jobs, setJobs] = useState<
    Record<string, Expanded<LabelJob, { TaskRef?: Task }, 'TaskRef'>>
  >({});
  const [latestTask, setLatestTask] = useState<Task | null>(null);

  const fetchJobs = async () => {
    try {
      const mediaService = new MediaService(pb);
      const fetchedJobs = (await mediaService.getLabelJobs(
        media.id
      )) as unknown as Expanded<LabelJob, { TaskRef?: Task }, 'TaskRef'>[];

      const jobsMap: Record<
        string,
        Expanded<LabelJob, { TaskRef?: Task }, 'TaskRef'>
      > = {};
      fetchedJobs.forEach((job) => {
        jobsMap[job.jobType] = job;
      });
      setJobs(jobsMap);

      // Also fetch the latest detect_labels task for this media
      const tasks = await pb.collection('Tasks').getList<Task>(1, 1, {
        filter: `sourceId = "${media.id}" && type = "detect_labels"`,
        sort: '-created',
      });
      setLatestTask(tasks.items[0] || null);
    } catch (error) {
      console.error('Failed to fetch label jobs:', error);
    }
  };

  useEffect(() => {
    fetchJobs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [media.id]);

  const handleRegenerate = async (type: string) => {
    try {
      setRegenerating((prev) => ({ ...prev, [type]: true }));
      const mediaService = new MediaService(pb);

      await mediaService.regenerateLabel(media.id, type);

      toast.success(`Regeneration started for ${type}`);
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
    let countDisplay = '-';

    if (task) {
      // LabelJob record exists with a linked Task
      status = Array.isArray(task.status) ? task.status[0] : task.status;

      const taskResult = task.result as Record<string, unknown> | undefined;

      // Check for step-based result format
      if (taskResult?.steps) {
        const steps = taskResult.steps as Record<
          string,
          Record<string, unknown>
        >;
        const stepKey = JOB_TYPE_TO_STEP[typeId];
        const stepResult = steps[stepKey];
        if (stepResult?.output) {
          countDisplay = getCountFromStepOutput(
            typeId,
            stepResult.output as Record<string, unknown>
          );
        }
      }

      // Check for legacy summary format
      if (countDisplay === '-' && taskResult?.summary) {
        const summary = taskResult.summary as Record<string, number>;
        if (typeId === 'object' && typeof summary.objectCount === 'number') {
          countDisplay = `${summary.objectCount} objects`;
        } else if (
          typeId === 'shot' &&
          typeof summary.labelCount === 'number'
        ) {
          countDisplay = `${summary.labelCount} labels`;
        }
      }
    } else if (latestTask) {
      // No LabelJob record — fall back to the latest detect_labels Task
      const taskResult = latestTask.result as
        | Record<string, unknown>
        | undefined;
      const stepKey = JOB_TYPE_TO_STEP[typeId];

      if (taskResult?.steps) {
        const steps = taskResult.steps as Record<
          string,
          Record<string, unknown>
        >;
        const stepResult = steps[stepKey];

        if (stepResult) {
          status = mapStepStatus(stepResult.status as string);
          if (stepResult.output) {
            countDisplay = getCountFromStepOutput(
              typeId,
              stepResult.output as Record<string, unknown>
            );
          }
        }
      }

      // If no step result yet, check if the task is still running
      // and this job type was enabled in the payload
      if (
        status === 'Not Run' &&
        (latestTask.status === 'queued' || latestTask.status === 'running')
      ) {
        const payload = latestTask.payload as Record<string, unknown>;
        const config = payload?.config as Record<string, unknown> | undefined;
        const configKey = JOB_TYPE_TO_CONFIG[typeId];
        if (config && config[configKey] === true) {
          status = Array.isArray(latestTask.status)
            ? latestTask.status[0]
            : latestTask.status;
        }
      }

      // If task succeeded but no specific step result (legacy format)
      if (status === 'Not Run' && latestTask.status === 'success') {
        const payload = latestTask.payload as Record<string, unknown>;
        const config = payload?.config as Record<string, unknown> | undefined;
        const configKey = JOB_TYPE_TO_CONFIG[typeId];
        if (!config || config[configKey] !== false) {
          status = 'success';

          // Try legacy summary format
          if (taskResult?.summary) {
            const summary = taskResult.summary as Record<string, number>;
            if (
              typeId === 'object' &&
              typeof summary.objectCount === 'number'
            ) {
              countDisplay = `${summary.objectCount} objects`;
            } else if (
              typeId === 'shot' &&
              typeof summary.labelCount === 'number'
            ) {
              countDisplay = `${summary.labelCount} labels`;
            }
          }
        }
      }
    }

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
