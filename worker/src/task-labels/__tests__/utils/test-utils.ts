import fs from 'fs';
import path from 'path';
import {
  FaceDetectionResponse,
  SpeechTranscriptionResponse,
  LabelDetectionResponse,
  ObjectTrackingResponse,
  PersonDetectionResponse,
  NormalizerInput,
  ExecutorResponse,
} from '../../types';

/**
 * Load a JSON fixture from the fixtures directory
 */
export const loadFixture = (filename: string): any => {
  const filePath = path.join(__dirname, '..', 'fixtures', filename);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
};

/**
 * Parse Google Cloud time offset to seconds
 */
export const parseTimeOffset = (timeOffset: any): number => {
  if (!timeOffset) return 0;
  const seconds = parseInt(String(timeOffset.seconds || '0'), 10);
  const nanos = parseInt(String(timeOffset.nanos || '0'), 10);
  return seconds + nanos / 1000000000;
};

/**
 * Parse bounding box to standardized format
 */
export const parseBoundingBox = (box: any) => ({
  left: box.left || 0,
  top: box.top || 0,
  right: box.right || 0,
  bottom: box.bottom || 0,
});

/**
 * Helper to create a NormalizerInput object
 */
export function createMockInput<T extends ExecutorResponse>(
  response: T,
  processor: string
): NormalizerInput<T> {
  return {
    response,
    mediaId: 'test-media-id',
    workspaceRef: 'test-workspace-ref',
    taskRef: 'test-task-ref',
    version: 1,
    processor,
    processorVersion: `${processor}:1.0.0`,
  };
}

/**
 * Map raw Face Detection fixture to FaceDetectionResponse
 */
export function mapFaceDetectionFixture(fixture: any): FaceDetectionResponse {
  const annotation = fixture.annotationResults[0];
  const faces = (annotation.faceDetectionAnnotations || []).map(
    (face: any, index: number) => {
      const track =
        face.tracks && face.tracks.length > 0 ? face.tracks[0] : null;
      const trackId =
        track?.trackId !== undefined &&
        track?.trackId !== null &&
        String(track.trackId) !== ''
          ? String(track.trackId)
          : String(index);

      return {
        trackId,
        faceId: face.faceId,
        thumbnail: face.thumbnail,
        frames: (track?.timestampedObjects || []).map((obj: any) => ({
          timeOffset: parseTimeOffset(obj.timeOffset),
          boundingBox: parseBoundingBox(obj.normalizedBoundingBox),
          confidence: obj.confidence || 0,
          attributes: (obj.attributes || []).reduce((acc: any, attr: any) => {
            acc[`${attr.name}Likelihood`] = attr.value;
            return acc;
          }, {}),
        })),
      };
    }
  );

  return { faces };
}

/**
 * Map raw Speech Transcription fixture to SpeechTranscriptionResponse
 */
export function mapSpeechTranscriptionFixture(
  fixture: any
): SpeechTranscriptionResponse {
  const annotation = fixture.annotationResults[0];
  let fullTranscript = '';
  let totalConfidence = 0;
  const allWords: any[] = [];

  for (const speechTranscription of annotation.speechTranscriptions || []) {
    if (
      speechTranscription.alternatives &&
      speechTranscription.alternatives.length > 0
    ) {
      const alternative = speechTranscription.alternatives[0];
      fullTranscript += alternative.transcript + ' ';
      totalConfidence += alternative.confidence || 0;

      if (alternative.words) {
        for (const word of alternative.words) {
          allWords.push({
            word: word.word || '',
            startTime: parseTimeOffset(word.startTime),
            endTime: parseTimeOffset(word.endTime),
            confidence: alternative.confidence || 0,
            speakerTag: word.speakerTag || undefined,
          });
        }
      }
    }
  }

  return {
    transcript: fullTranscript.trim(),
    confidence:
      (annotation.speechTranscriptions || []).length > 0
        ? totalConfidence / annotation.speechTranscriptions.length
        : 0,
    words: allWords,
    languageCode: 'en-US',
  };
}

/**
 * Map raw Label Detection fixture to LabelDetectionResponse
 */
export function mapLabelDetectionFixture(fixture: any): LabelDetectionResponse {
  const annotation = fixture.annotationResults[0];

  return {
    segmentLabels: (annotation.segmentLabelAnnotations || []).map(
      (label: any) => ({
        entity: label.entity.description,
        confidence: (label.segments || [])[0]?.confidence || 0,
        segments: (label.segments || []).map((s: any) => ({
          startTime: parseTimeOffset(s.segment.startTimeOffset),
          endTime: parseTimeOffset(s.segment.endTimeOffset),
          confidence: s.confidence,
        })),
      })
    ),
    shotLabels: (annotation.shotLabelAnnotations || []).map((label: any) => ({
      entity: label.entity.description,
      confidence: (label.segments || [])[0]?.confidence || 0,
      segments: (label.segments || []).map((s: any) => ({
        startTime: parseTimeOffset(s.segment.startTimeOffset),
        endTime: parseTimeOffset(s.segment.endTimeOffset),
        confidence: s.confidence,
      })),
    })),
    shots: (annotation.shotAnnotations || []).map((shot: any) => ({
      startTime: parseTimeOffset(shot.startTimeOffset),
      endTime: parseTimeOffset(shot.endTimeOffset),
    })),
  };
}

/**
 * Map raw Object Tracking fixture to ObjectTrackingResponse
 */
export function mapObjectTrackingFixture(fixture: any): ObjectTrackingResponse {
  const annotation = fixture.annotationResults[0];

  return {
    objects: (annotation.objectAnnotations || []).map(
      (obj: any, index: number) => {
        const trackId =
          obj.trackId !== undefined &&
          obj.trackId !== null &&
          String(obj.trackId) !== ''
            ? String(obj.trackId)
            : String(index);
        return {
          entity: obj.entity.description,
          trackId,
          confidence: obj.confidence || 0,
          frames: (obj.frames || []).map((f: any) => ({
            timeOffset: parseTimeOffset(f.timeOffset),
            boundingBox: parseBoundingBox(f.normalizedBoundingBox),
            confidence: obj.confidence || 0,
          })),
        };
      }
    ),
  };
}

/**
 * Map raw Person Detection fixture to PersonDetectionResponse
 */
export function mapPersonDetectionFixture(
  fixture: any
): PersonDetectionResponse {
  const annotation = fixture.annotationResults[0];
  const persons: any[] = [];

  let personIdx = 0;
  for (const person of annotation.personDetectionAnnotations || []) {
    for (const track of person.tracks || []) {
      const trackId =
        track.trackId !== undefined &&
        track.trackId !== null &&
        String(track.trackId) !== ''
          ? String(track.trackId)
          : String(personIdx++);
      persons.push({
        trackId: trackId,
        frames: (track.timestampedObjects || []).map((obj: any) => {
          const attributes: any = {};
          if (obj.attributes) {
            for (const attr of obj.attributes) {
              const name = attr.name?.toLowerCase() || '';
              if (name === 'uppercloth' || name === 'upper_clothing_color') {
                attributes.upperClothingColor = attr.value;
              } else if (
                name === 'lowercloth' ||
                name === 'lower_clothing_color'
              ) {
                attributes.lowerClothingColor = attr.value;
              }
            }
          }
          return {
            timeOffset: parseTimeOffset(obj.timeOffset),
            boundingBox: parseBoundingBox(obj.normalizedBoundingBox),
            confidence: track.confidence || 0,
            attributes:
              Object.keys(attributes).length > 0 ? attributes : undefined,
            landmarks: (obj.landmarks || []).map((l: any) => ({
              type: l.name,
              position: { x: l.point.x, y: l.point.y, z: 0 },
              confidence: l.confidence || 0,
            })),
          };
        }),
      });
    }
  }

  return { persons };
}
