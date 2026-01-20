// Label data types for compact storage in LabelClips collection

export interface BaseLabelData {
  entityId: string;
  entityDescription: string;
  rawJsonPath: string; // StorageBackend path to full provider response
  providerPayload?: Record<string, unknown>; // Minimal provider-specific data
}

export interface ObjectLabelData extends BaseLabelData {
  category?: string;
  boundingBoxSamples: Array<{
    timeOffset: number;
    left: number;
    top: number;
    right: number;
    bottom: number;
  }>; // Max 10 representative samples
}

export interface ShotLabelData extends BaseLabelData {
  shotIndex: number;
  transitionType?: string;
}

export interface PersonLabelData extends BaseLabelData {
  trackId?: string;
  boundingBoxSamples: Array<{
    timeOffset: number;
    left: number;
    top: number;
    right: number;
    bottom: number;
  }>; // Max 10 representative samples
}

export interface SpeechLabelData extends BaseLabelData {
  transcript: string;
  languageCode: string;
  wordCount: number;
  speakerId?: string;
}

export type LabelData =
  | ObjectLabelData
  | ShotLabelData
  | PersonLabelData
  | SpeechLabelData;
