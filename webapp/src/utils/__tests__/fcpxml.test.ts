import { describe, it, expect } from 'vitest';
import { generateFCPXML } from '../fcpxml';
import type { TimelineWithClips } from '@/services/timeline';
import type { Media } from '@project/shared/schema';

describe('generateFCPXML', () => {
  it('should generate valid FCPXML for a simple timeline', () => {
    const timeline: TimelineWithClips = {
      id: 'timeline-1',
      name: 'Test Timeline',
      WorkspaceRef: 'workspace-1',
      duration: 10,
      version: 1,
      clips: [
        {
          id: 'clip-1',
          TimelineRef: 'timeline-1',
          TimelineTrackRef: 'track-1',
          MediaRef: 'media-1',
          order: 0,
          start: 0,
          end: 5,
          duration: 5,
          timelineStart: 0,
        },
        {
          id: 'clip-2',
          TimelineRef: 'timeline-1',
          TimelineTrackRef: 'track-1',
          MediaRef: 'media-2',
          order: 1,
          start: 10,
          end: 15,
          duration: 5,
          timelineStart: 5,
        },
      ],
      tracks: [
        {
          id: 'track-1',
          TimelineRef: 'timeline-1',
          name: 'Main Track',
          layer: 0,
          created: '',
          updated: '',
        },
      ],
      created: '',
      updated: '',
    };

    const mediaMap = new Map<string, Media>();
    mediaMap.set('media-1', {
      id: 'media-1',
      WorkspaceRef: 'workspace-1',
      UploadRef: 'upload-1',
      mediaType: 'VIDEO',
      duration: 100,
      width: 1920,
      height: 1080,
      aspectRatio: 1.77,
      mediaData: {},
      created: '',
      updated: '',
    });
    mediaMap.set('media-2', {
      id: 'media-2',
      WorkspaceRef: 'workspace-1',
      UploadRef: 'upload-2',
      mediaType: 'VIDEO',
      duration: 200,
      width: 1920,
      height: 1080,
      aspectRatio: 1.77,
      mediaData: {},
      created: '',
      updated: '',
    });

    const xml = generateFCPXML(timeline, mediaMap);

    // Basic structure checks
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<fcpxml version="1.10">');
    expect(xml).toContain('<resources>');
    expect(xml).toContain('<library>');
    expect(xml).toContain('<event name="Exported Timeline">');
    expect(xml).toContain('<project name="Test Timeline" uid="timeline-1">');

    // Check for resources
    expect(xml).toContain('id="asset_media-1"');
    expect(xml).toContain('uid="media-1"');
    expect(xml).toContain('id="asset_media-2"');
    expect(xml).toContain('uid="media-2"');

    // Check for sequence and clips
    // Clip 1: start 0, duration 5 -> offset 0s, duration 150/30s
    expect(xml).toContain('<video name="media-1" offset="0/30s" ref="asset_media-1" duration="150/30s" start="0/30s">');

    // Clip 2: start 10, duration 5, timelineStart 5 -> offset 5s (150/30s), duration 150/30s, start 10s (300/30s)
    expect(xml).toContain('<video name="media-2" offset="150/30s" ref="asset_media-2" duration="150/30s" start="300/30s">');
  });

  it('should handle gaps correctly', () => {
    const timeline: TimelineWithClips = {
      id: 'timeline-2',
      name: 'Gap Timeline',
      WorkspaceRef: 'workspace-1',
      duration: 15,
      version: 1,
      clips: [
        {
          id: 'clip-1',
          TimelineRef: 'timeline-2',
          TimelineTrackRef: 'track-1',
          MediaRef: 'media-1',
          order: 0,
          start: 0,
          end: 5,
          duration: 5,
          timelineStart: 0,
        },
        // Gap from 5 to 10
        {
          id: 'clip-2',
          TimelineRef: 'timeline-2',
          TimelineTrackRef: 'track-1',
          MediaRef: 'media-1',
          order: 1,
          start: 0,
          end: 5,
          duration: 5,
          timelineStart: 10,
        },
      ],
      tracks: [
        {
          id: 'track-1',
          TimelineRef: 'timeline-2',
          name: 'Main Track',
          layer: 0,
          created: '',
          updated: '',
        },
      ],
      created: '',
      updated: '',
    };

    const mediaMap = new Map<string, Media>();
    mediaMap.set('media-1', {
      id: 'media-1',
      WorkspaceRef: 'workspace-1',
      UploadRef: 'upload-1',
      mediaType: 'VIDEO',
      duration: 100,
      width: 1920,
      height: 1080,
      aspectRatio: 1.77,
      mediaData: {},
      created: '',
      updated: '',
    });

    const xml = generateFCPXML(timeline, mediaMap);

    // Check for gap
    // Gap starts at 5s (150/30s) and lasts 5s (150/30s)
    expect(xml).toContain('<gap name="Gap" offset="150/30s" duration="150/30s" start="0s"/>');

    // Second clip starts at 10s (300/30s)
    expect(xml).toContain('offset="300/30s"');
  });
});
