# Flow Definitions

This document explains the type-safe flow definitions that ensure all required steps are included in each job flow.

## Overview

Flow definitions provide compile-time guarantees that flow builders implement all required steps. This prevents mistakes like forgetting to add new steps (e.g., the AUDIO step) to the flow builder.

## Transcode Flow

### Required Steps

The transcode flow processes uploaded media files and generates various assets:

1. **PROBE** (required) - Extracts media metadata
2. **THUMBNAIL** (optional) - Generates a thumbnail image
3. **SPRITE** (optional) - Generates a sprite sheet for scrubbing
4. **FILMSTRIP** (optional) - Generates filmstrip for preview
5. **TRANSCODE** (optional) - Creates a proxy video
6. **AUDIO** (optional) - Extracts audio-only track

### Type Definition

```typescript
import { TRANSCODE_FLOW_STEPS } from '@project/shared/jobs';

// Ensures all steps are accounted for
const steps = {
  PROBE: TRANSCODE_FLOW_STEPS.PROBE,
  THUMBNAIL: TRANSCODE_FLOW_STEPS.THUMBNAIL,
  SPRITE: TRANSCODE_FLOW_STEPS.SPRITE,
  FILMSTRIP: TRANSCODE_FLOW_STEPS.FILMSTRIP,
  TRANSCODE: TRANSCODE_FLOW_STEPS.TRANSCODE,
  AUDIO: TRANSCODE_FLOW_STEPS.AUDIO,
};
```

### Usage in Flow Builder

```typescript
// In TranscodeFlowBuilder.buildFlow()

// AUDIO step (if enabled)
if (payload.audio?.enabled) {
  const audioOptions = getStepJobOptions(TranscodeStepType.AUDIO);
  flow.children.push({
    name: TranscodeStepType.AUDIO,
    queueName: QUEUE_NAMES.TRANSCODE,
    data: {
      ...baseJobData,
      stepType: TranscodeStepType.AUDIO,
      parentJobId: '',
      input: {
        type: 'audio',
        uploadId,
        filePath: '',
        format: payload.audio.format,
        bitrate: payload.audio.bitrate,
        channels: payload.audio.channels,
        sampleRate: payload.audio.sampleRate,
      },
    },
    opts: audioOptions,
  });
}
```

### Payload Configuration

```typescript
const payload: ProcessUploadPayload = {
  uploadId: 'upload-id',
  provider: ProcessingProvider.FFMPEG,
  thumbnail: { timestamp: 1, width: 320, height: 240 },
  sprite: { fps: 1, cols: 10, rows: 10, tileWidth: 160, tileHeight: 120 },
  filmstrip: { cols: 100, rows: 1, tileWidth: 320 },
  transcode: { enabled: true, codec: 'h264', resolution: '720p' },
  audio: {
    enabled: true,
    format: 'mp3',
    bitrate: '192k',
    channels: 2,
    sampleRate: 48000,
  },
};
```

## Render Flow

### Required Steps

The render flow renders timelines into video files:

1. **PREPARE** (required) - Resolves clips and ensures media availability
2. **EXECUTE** (required) - Runs FFmpeg or Google Cloud Transcoder
3. **FINALIZE** (required) - Probes output and creates database records

### Type Definition

```typescript
import { RENDER_FLOW_STEPS } from '@project/shared/jobs';

const steps = {
  PREPARE: RENDER_FLOW_STEPS.PREPARE,
  EXECUTE: RENDER_FLOW_STEPS.EXECUTE,
  FINALIZE: RENDER_FLOW_STEPS.FINALIZE,
};
```

### Dependencies

- EXECUTE depends on PREPARE
- FINALIZE depends on EXECUTE

## Labels Flow

### Required Steps

The labels flow detects labels, objects, faces, people, and speech in media:

1. **UPLOAD_TO_GCS** (required) - Uploads media to Google Cloud Storage
2. **LABEL_DETECTION** (required) - Detects labels/shots
3. **OBJECT_TRACKING** (required) - Tracks objects across frames
4. **FACE_DETECTION** (required) - Detects faces
5. **PERSON_DETECTION** (required) - Detects people
6. **SPEECH_TRANSCRIPTION** (required) - Transcribes speech to text

### Type Definition

```typescript
import { LABELS_FLOW_STEPS } from '@project/shared/jobs';

const steps = {
  UPLOAD_TO_GCS: LABELS_FLOW_STEPS.UPLOAD_TO_GCS,
  LABEL_DETECTION: LABELS_FLOW_STEPS.LABEL_DETECTION,
  OBJECT_TRACKING: LABELS_FLOW_STEPS.OBJECT_TRACKING,
  FACE_DETECTION: LABELS_FLOW_STEPS.FACE_DETECTION,
  PERSON_DETECTION: LABELS_FLOW_STEPS.PERSON_DETECTION,
  SPEECH_TRANSCRIPTION: LABELS_FLOW_STEPS.SPEECH_TRANSCRIPTION,
};
```

### Dependencies

All detection steps depend on UPLOAD_TO_GCS.

## Adding New Steps

When adding a new step to a flow:

1. **Update the step type enum** in `shared/src/jobs/{flow}/types.ts`
2. **Add the step to the flow definition** in `shared/src/jobs/flow-definitions.ts`
3. **Update the flow builder** in `worker/src/queue/flows/{flow}-flow.builder.ts`
4. **Create the step processor** in `worker/src/task-{flow}/processors/`
5. **Register the processor** in the module

### Example: Adding the AUDIO Step

```typescript
// 1. Add to TranscodeStepType enum
export enum TranscodeStepType {
  PROBE = 'transcode:probe',
  THUMBNAIL = 'transcode:thumbnail',
  SPRITE = 'transcode:sprite',
  FILMSTRIP = 'transcode:filmstrip',
  TRANSCODE = 'transcode:transcode',
  AUDIO = 'transcode:audio', // NEW
  FINALIZE = 'transcode:finalize',
}

// 2. Add to flow definition
export const TRANSCODE_FLOW_STEPS = {
  PROBE: TranscodeStepType.PROBE,
  THUMBNAIL: TranscodeStepType.THUMBNAIL,
  SPRITE: TranscodeStepType.SPRITE,
  FILMSTRIP: TranscodeStepType.FILMSTRIP,
  TRANSCODE: TranscodeStepType.TRANSCODE,
  AUDIO: TranscodeStepType.AUDIO, // NEW
} as const;

// 3. Update flow builder (see above)
// 4. Create AudioStepProcessor
// 5. Register in TranscodeModule
```

## Benefits

1. **Type Safety**: TypeScript ensures all steps are accounted for
2. **Documentation**: Flow definitions serve as documentation
3. **Maintainability**: Easy to see what steps are required
4. **Consistency**: All flows follow the same pattern
5. **Error Prevention**: Compile-time errors if steps are missing

## Validation

The flow definitions use TypeScript's type system to validate that all steps are properly implemented:

```typescript
// This will cause a compile error if a step is missing
export type TranscodeStepTypes = ExtractStepTypes<TranscodeFlowSteps>;
```

This ensures that the flow builder cannot forget to implement a step that's defined in the flow definition.
