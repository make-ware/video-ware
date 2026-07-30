# Audio Waveform Step

The waveform step renders a media's audio track as PNG waveform images during
ingest, so the editor can draw an audio overview without decoding the media.

## Features

- Renders the audio track with FFmpeg's `showwavespic` (peak filter)
- Chunks long media at a fixed pixels-per-second scale
- Configurable size, colour, and mono/split-channel drawing
- Stores each chunk as a `waveform` File in PocketBase
- Links every chunk back to the Media via `Media.waveformFileRefs`

## Why chunked

A single image squashes millions of samples into each pixel — a two-hour
podcast drawn whole is a solid block, and FFmpeg cannot render past roughly
32k px anyway. Chunks are cut at a fixed horizontal scale (`pixelsPerSecond`),
so every image of a media shares one time-to-pixel mapping and a consumer can
lay them end to end. The geometry lives in
[`shared/src/utils/waveform.ts`](../../../../shared/src/utils/waveform.ts)
(`planWaveformChunks`), not in the processor, so it is pure and unit-tested.

Chunk boundaries follow `width / pixelsPerSecond` seconds. The trailing chunk is
narrower rather than stretched; a leftover under one second is folded into its
predecessor instead of becoming a sliver image.

## Usage

```typescript
const waveformStep = {
  type: 'waveform',
  filePath: '/path/to/video.mp4',
  uploadId: 'upload-id-here',
  config: {
    width: 1000, // px per full chunk
    height: 200, // px, every chunk
    pixelsPerSecond: 1, // horizontal scale
    color: 'white', // ffmpeg colour name or #rrggbb
    mono: true, // downmix instead of one curve per channel
  },
};
```

## Default values

The ingest orchestrator requests `1000x200` at `1` px/s, white, mono — one
image per ~16.6 minutes of audio. Images are skipped entirely; video and audio
media both get waveforms.

## FFmpeg command

Per chunk, with the window seeked on the input side:

```bash
ffmpeg -y -ss 2000 -t 500 -i input.mp4 \
  -filter_complex "[0:a]aformat=channel_layouts=mono,showwavespic=s=500x200:colors=white:filter=peak[wave]" \
  -map "[wave]" -frames:v 1 waveform_2.png
```

`filter=peak` draws the sample extremes; over a long window the default average
collapses into a solid bar. With `mono: false` the `aformat` downmix is dropped
and `split_channels=1` stacks the channels instead.

## Skips

The step returns an empty result — no files, no Media update — when:

- the media is an image,
- the probe found no audio stream (a silent file has nothing to draw, and the
  `[0:a]` filter input would fail), or
- the media has no measurable duration.

## Output

```typescript
{
  waveformPath: string;          // Local path to the first chunk
  waveformFileId: string;        // First chunk's File record ID
  allWaveformFileIds: string[];  // Every chunk, in order
}
```

## File storage

- **Storage key**: `transcode/{workspaceRef}/{uploadId}/waveform/waveform_{n}.png`
- **File Type**: `FileType.WAVEFORM`
- **MIME type**: `image/png` (transparent background)

## Stored metadata

Each chunk's File carries `meta.waveformConfig` describing what that image
actually contains — never the request, since the trailing chunk differs:

```typescript
{
  width: number;           // pixel width of this image
  height: number;
  pixelsPerSecond: number; // horizontal scale
  color?: string;
  mono?: boolean;
  chunkIndex: number;      // 0-based position within the media
  startTime: number;       // absolute media time of the first pixel
  duration: number;        // seconds of audio drawn
}
```

Read it back with `normalizeWaveformSegments` / `waveformSegmentForTime` rather
than relying on relation order.
