import type { Media } from '@project/shared/schema';
import type { TimelineWithClips } from '@/services/timeline';

// Constants for FCPXML
const FCPXML_VERSION = '1.9';
const DEFAULT_FRAME_RATE = 30;
const TIMEBASE = 30; // Using integer 30fps for simplicity, can be improved to support 29.97 etc.

/**
 * Escapes special characters for XML content
 */
function escapeXML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Converts seconds to FCPXML rational time string (e.g., "100/30s")
 */
function toRationalTime(seconds: number, fps: number = TIMEBASE): string {
  const frames = Math.round(seconds * fps);
  return `${frames}/${fps}s`;
}

/**
 * Generates FCPXML string from timeline and media data
 */
export function generateFCPXML(
  timeline: TimelineWithClips,
  mediaMap: Map<string, Media>
): string {
  const fps = DEFAULT_FRAME_RATE;
  const frameDuration = `1/${fps}s`;
  const duration = toRationalTime(timeline.duration || 0, fps);

  // XML Header
  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<fcpxml version="${FCPXML_VERSION}">\n`;

  // Resources (Media Definitions)
  xml += `  <resources>\n`;

  // Define project format (Timeline settings)
  // Assuming 1920x1080 for now, could be derived from first clip or project settings
  xml += `    <format id="r1" name="FFVideoFormat1080p${fps}" frameDuration="${frameDuration}" width="1920" height="1080" colorSpace="1-1-1 (Rec. 709)"/>\n`;

  // Add media assets
  const mediaIds = new Set<string>();
  timeline.clips.forEach((clip) => {
    if (clip.MediaRef) mediaIds.add(clip.MediaRef);
  });

  mediaIds.forEach((mediaId) => {
    const media = mediaMap.get(mediaId);
    if (media) {
      // Use a generic filename if not available, usually media.id + extension
      // Note: In a real app, you might want actual file paths or URLs.
      // FCPXML often expects local paths or accessible URLs.
      // For DaVinci Resolve import, filename matching is key.
      const filename = `media_${media.id}.mp4`; // Placeholder extension
      const src = `file:///placeholder/${filename}`; // Placeholder path
      const mediaDuration = toRationalTime(media.duration, fps);

      // Asset ID logic: 'r' + mediaId to ensure it starts with a letter and is unique-ish (but short)
      // Actually FCPXML uses integer IDs or 'r' + number usually. Let's use 'r' + index or hash.
      // To keep it simple, we'll prefix "asset_"
      const assetId = `asset_${media.id}`;

      xml += `    <asset id="${assetId}" name="${escapeXML(filename)}" uid="${media.id}" src="${src}" start="0s" duration="${mediaDuration}" hasVideo="1" format="r1" />\n`;
    }
  });

  xml += `  </resources>\n`;

  // Library / Event / Project structure
  xml += `  <library>\n`;
  xml += `    <event name="Exported Timeline">\n`;
  xml += `      <project name="${escapeXML(timeline.name)}" uid="${timeline.id}">\n`;

  // Sequence
  xml += `        <sequence duration="${duration}" format="r1" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">\n`;
  xml += `          <spine>\n`;

  // Clips and Gaps
  // We need to process clips in order and insert gaps where needed.
  // The timeline clips should already be sorted by order, but let's make sure.
  const sortedClips = [...timeline.clips].sort((a, b) => a.order - b.order);

  // Since our timeline model supports multiple tracks, we need to handle that.
  // FCPXML <spine> represents the primary storyline (usually V1).
  // Connected clips (secondary storylines/tracks) are children of the primary clips or gaps.
  // For simplicity V1, we'll flatten everything to the spine or just handle the main track (layer 0).
  // If we want to support multiple tracks properly, we need to identify the "spine" items and attach others as "connected" clips.

  // Simplification: Let's assume a single track (layer 0) for the spine for now,
  // or just layout clips sequentially based on their timelineStart/end.

  // Ideally, we should use 'lanes' or 'connected' clips.
  // FCPXML 1.10 supports lanes.

  // Let's filter for the main track (layer 0) first to build the spine.
  const mainTrack = timeline.tracks.find((t) => t.layer === 0);
  const mainTrackId = mainTrack?.id;

  const spineClips = sortedClips.filter(
    (c) => c.TimelineTrackRef === mainTrackId || (!mainTrackId && c.order >= 0)
  );

  let currentTime = 0;

  spineClips.forEach((clip) => {
    // Check for gap
    if (clip.timelineStart !== undefined && clip.timelineStart > currentTime) {
      const gapDuration = clip.timelineStart - currentTime;
      if (gapDuration > 0.001) {
        // distinct gap
        xml += `            <gap name="Gap" offset="${toRationalTime(currentTime, fps)}" duration="${toRationalTime(gapDuration, fps)}" start="0s"/>\n`;
        currentTime += gapDuration;
      }
    }

    // Video clip
    const media = mediaMap.get(clip.MediaRef);
    if (media) {
      const assetId = `asset_${clip.MediaRef}`;
      const clipDuration = toRationalTime(clip.end - clip.start, fps);
      const clipStart = toRationalTime(clip.start, fps); // Start time inside the media
      const clipOffset = toRationalTime(currentTime, fps); // Start time on timeline

      xml += `            <video name="${escapeXML(media.id)}" offset="${clipOffset}" ref="${assetId}" duration="${clipDuration}" start="${clipStart}">\n`;
      xml += `            </video>\n`;
    } else {
      // Fallback for missing media
      const clipDuration = toRationalTime(clip.end - clip.start, fps);
      const clipOffset = toRationalTime(currentTime, fps);
      xml += `            <gap name="Missing Media" offset="${clipOffset}" duration="${clipDuration}" start="0s"/>\n`;
    }

    currentTime += clip.end - clip.start;
  });

  xml += `          </spine>\n`;
  xml += `        </sequence>\n`;
  xml += `      </project>\n`;
  xml += `    </event>\n`;
  xml += `  </library>\n`;

  xml += `</fcpxml>\n`;

  return xml;
}
