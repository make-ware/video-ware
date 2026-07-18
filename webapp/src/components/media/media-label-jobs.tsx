'use client';

import { useState, useEffect } from 'react';
import {
  Media,
  Expanded,
  LabelJob,
  Task,
  DetectLabelsConfig,
  LabelJobType,
  LABEL_JOB_TYPE_TO_STEP,
  LABEL_JOB_TYPE_TO_CONFIG_KEY,
  isLabelTypeRequested,
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
  media: Media;
  onUpdate: () => void;
}

const JOB_TYPES: { id: LabelJobType; label: string }[] = [
  { id: 'object', label: 'Object Detection' },
  { id: 'shot', label: 'Shot & Label Detection' },
  { id: 'face', label: 'Face Detection' },
  { id: 'person', label: 'Person Detection' },
  { id: 'text', label: 'Text Detection' },
  { id: 'speech', label: 'Speech Transcription' },
  { id: 'speaker', label: 'Speaker Transcription' },
];

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
    case 'text':
      if (typeof counts.textCount === 'number')
        return `${counts.textCount} texts`;
      if (typeof counts.labelTextCount === 'number')
        return `${counts.labelTextCount} texts`;
      return '-';
    case 'speech':
      if (typeof counts.wordCount === 'number')
        return `${counts.wordCount} words`;
      if (typeof counts.labelSpeechCount === 'number')
        return `${counts.labelSpeechCount} words`;
      return '-';
    case 'speaker':
      if (
        typeof counts.speakerCount === 'number' &&
        typeof counts.labelSpeakerCount === 'number'
      )
        return `${counts.speakerCount} speakers, ${counts.labelSpeakerCount} utterances`;
      if (typeof counts.labelSpeakerCount === 'number')
        return `${counts.labelSpeakerCount} utterances`;
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

type StepResultRecord = Record<string, unknown> & {
  status?: string;
  output?: Record<string, unknown>;
};

function getTaskSteps(
  task: Task
): Record<string, StepResultRecord> | undefined {
  const result = task.result as Record<string, unknown> | undefined;
  return result?.steps as Record<string, StepResultRecord> | undefined;
}

function getTaskConfig(task: Task): DetectLabelsConfig | undefined {
  const payload = task.payload as Record<string, unknown> | undefined;
  return payload?.config as DetectLabelsConfig | undefined;
}

function getTaskStatus(task: Task): string {
  return Array.isArray(task.status) ? task.status[0] : task.status;
}

/**
 * Whether a task ran (or, if still active, will run) the given job type.
 * Completed modern tasks record per-step results; active tasks are judged by
 * their payload config; legacy tasks (no result.steps) keep the historical
 * defaults where GCVI detections ran unless explicitly disabled and speaker
 * transcription was opt-in.
 */
function taskInvolvesType(task: Task, typeId: LabelJobType): boolean {
  const stepKey = LABEL_JOB_TYPE_TO_STEP[typeId];
  const steps = getTaskSteps(task);
  if (steps?.[stepKey]) return true;

  const status = getTaskStatus(task);
  const config = getTaskConfig(task);
  if (status === 'queued' || status === 'running') {
    return isLabelTypeRequested(config, typeId);
  }
  if (!steps && (status === 'success' || status === 'failed')) {
    return typeId === 'speaker'
      ? config?.detectSpeakers === true
      : !config || config[LABEL_JOB_TYPE_TO_CONFIG_KEY[typeId]] !== false;
  }
  return false;
}

/**
 * The most recent task that involves a job type. Candidates are the task the
 * LabelJob record points at plus the recent detect_labels tasks, so a
 * single-type regenerate never hides the other types' last results, and a
 * newer full run wins over a stale LabelJob pointer.
 */
function resolveTaskForType(
  typeId: LabelJobType,
  jobTask: Task | undefined,
  recentTasks: Task[]
): Task | null {
  let newest: Task | null = null;
  const seen = new Set<string>();
  for (const task of jobTask ? [jobTask, ...recentTasks] : recentTasks) {
    if (seen.has(task.id)) continue;
    seen.add(task.id);
    if (!taskInvolvesType(task, typeId)) continue;
    if (!newest || String(task.created) > String(newest.created)) {
      newest = task;
    }
  }
  return newest;
}

export function MediaLabelJobs({ media, onUpdate }: MediaLabelJobsProps) {
  const [regenerating, setRegenerating] = useState<Record<string, boolean>>({});
  const [jobs, setJobs] = useState<
    Record<string, Expanded<LabelJob, { TaskRef?: Task }, 'TaskRef'>>
  >({});
  const [recentTasks, setRecentTasks] = useState<Task[]>([]);

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

      // Also fetch recent detect_labels tasks: each job type resolves against
      // the newest task that actually ran it, so a single-type regenerate
      // (whose task has only one step) can't make the others look missing.
      const tasks = await pb.collection('Tasks').getList<Task>(1, 30, {
        filter: `sourceId = "${media.id}" && type = "detect_labels"`,
        sort: '-created',
      });
      setRecentTasks(tasks.items);
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

  const renderJobRow = (typeId: LabelJobType, label: string) => {
    const jobTask = jobs[typeId]?.expand?.TaskRef as Task | undefined;
    const task = resolveTaskForType(typeId, jobTask, recentTasks);

    let status = 'Not Run';
    let countDisplay = '-';

    if (task) {
      const stepResult = getTaskSteps(task)?.[LABEL_JOB_TYPE_TO_STEP[typeId]];

      if (stepResult) {
        // The step's own status/output, so one type's failure (or a
        // single-type rerun) never masquerades as the others' status.
        status = mapStepStatus(stepResult.status as string);
        if (stepResult.output) {
          countDisplay = getCountFromStepOutput(typeId, stepResult.output);
        }
      } else {
        // Step not recorded yet (task still queued/running) or legacy
        // result format without per-step results.
        status = getTaskStatus(task);
        const taskResult = task.result as Record<string, unknown> | undefined;
        if (status === 'success' && taskResult?.summary) {
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
