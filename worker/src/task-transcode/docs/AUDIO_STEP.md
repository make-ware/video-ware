# Audio Extraction Step

The audio extraction step allows you to extract a stereo audio-only track from video files during the transcode process.

## Features

- Extracts audio from video files
- Configurable audio format (MP3, AAC, WAV)
- Configurable bitrate, channels, and sample rate
- Stores audio file in PocketBase
- Updates Media record with audio file reference

## Usage

### Basic Example

```typescript
import { TranscodeStepType } from '@project/shared/jobs';

const audioStep = {
  type: 'audio',
  filePath: '/path/to/video.mp4',
  uploadId: 'upload-id-here',
};
```

### Advanced Example with Custom Settings

```typescript
const audioStep = {
  type: 'audio',
  filePath: '/path/to/video.mp4',
  uploadId: 'upload-id-here',
  format: 'mp3', // 'mp3', 'aac', or 'wav'
  bitrate: '256k', // Audio bitrate
  channels: 2, // 2 for stereo, 1 for mono
  sampleRate: 48000, // Sample rate in Hz
};
```

## Default Values

- **format**: `'mp3'`
- **bitrate**: `'192k'`
- **channels**: `2` (stereo)
- **sampleRate**: `48000` Hz

## Output

The step returns:

```typescript
{
  audioPath: string;      // Local path to the extracted audio file
  audioFileId: string;    // PocketBase File record ID
}
```

## Media Record Update

The step automatically updates the Media record with the `audioFileRef` field pointing to the created File record.

## File Storage

Audio files are stored in PocketBase with the following structure:

- **Storage Key**: `uploads/{workspaceRef}/{uploadId}/audio/audio.{extension}`
- **File Type**: `FileType.AUDIO`
- **MIME Types**:
  - MP3: `audio/mpeg`
  - AAC: `audio/aac`
  - WAV: `audio/wav`

## Integration with Transcode Flow

You can add the audio step to your transcode flow alongside other steps:

```typescript
const transcodeFlow = {
  taskId: 'task-id',
  steps: [
    { type: 'probe', filePath: '/path/to/video.mp4', uploadId: 'upload-id' },
    { type: 'thumbnail', filePath: '/path/to/video.mp4', uploadId: 'upload-id', config: {...} },
    { type: 'transcode', filePath: '/path/to/video.mp4', uploadId: 'upload-id', config: {...} },
    { type: 'audio', filePath: '/path/to/video.mp4', uploadId: 'upload-id' }, // Audio extraction
  ],
};
```
