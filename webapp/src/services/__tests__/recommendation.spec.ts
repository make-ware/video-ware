import { describe, it, expect, vi } from 'vitest';
import { RecommendationService } from '../recommendation';
import { TypedPocketBase } from '@project/shared/types';

describe('RecommendationService', () => {
  const mockPb = {
    collection: vi.fn().mockReturnValue({
      getOne: vi.fn(),
      getList: vi.fn(),
      create: vi
        .fn()
        .mockImplementation((data) =>
          Promise.resolve({ id: 'new_id', ...data })
        ),
      update: vi
        .fn()
        .mockImplementation((id, data) => Promise.resolve({ id, ...data })),
    }),
  } as unknown as TypedPocketBase;

  it('should be instantiable', () => {
    const service = new RecommendationService(mockPb);
    expect(service).toBeDefined();
  });

  it('should have required methods', () => {
    const service = new RecommendationService(mockPb);
    expect(service.getMediaRecommendations).toBeDefined();
    expect(service.getTimelineRecommendations).toBeDefined();
    expect(service.getTimelineClipReplacementRecommendations).toBeDefined();
  });

  describe('getMediaRecommendations', () => {
    it('should return recommended segments based on entities', async () => {
      const service = new RecommendationService(mockPb);

      // Mock data loading
      vi.spyOn(service as any, 'loadMediaContext').mockResolvedValue({
        workspace: { id: 'ws1' },
        media: { id: 'm1' },
        labelFaces: [],
        labelPeople: [
          {
            id: 'lc1',
            MediaRef: 'm1',
            LabelEntityRef: 'e1',
            start: 0,
            end: 5,
            confidence: 0.9,
          },
          {
            id: 'lc2',
            MediaRef: 'm1',
            LabelEntityRef: 'e1',
            start: 10,
            end: 15,
            confidence: 0.8,
          },
        ],
        labelObjects: [],
        labelShots: [],
        labelTracks: [],
        labelSpeech: [],
        labelEntities: [{ id: 'e1', canonicalName: 'John Doe' }],
        existingClips: [],
        filterParams: {},
      });

      // Mock mutators
      (service as any).mediaRecommendationMutator = {
        getTopByQueryHash: vi.fn().mockResolvedValue([]),
        upsert: vi
          .fn()
          .mockImplementation((input) =>
            Promise.resolve({ id: 'rec_id', ...input })
          ),
      };

      const recommendations = await service.getMediaRecommendations(
        'ws1',
        'm1'
      );

      expect(recommendations).toHaveLength(2);
      expect(recommendations[0].reason).toContain('Same entity found');
      expect(recommendations[0].start).toBe(0);
      expect(recommendations[1].start).toBe(10);
      expect(recommendations[0].score).toBeCloseTo(0.89, 1);
      expect(recommendations[1].score).toBeCloseTo(0.79, 1);
      expect(
        (service as any).mediaRecommendationMutator.upsert
      ).toHaveBeenCalledTimes(2);
    });
  });

  describe('getTimelineRecommendations', () => {
    it('should return recommended clips based on shared entities with seed clip', async () => {
      const service = new RecommendationService(mockPb);

      // Mock data loading
      vi.spyOn(service as any, 'loadTimelineContext').mockResolvedValue({
        workspace: { id: 'ws1' },
        timeline: { id: 't1' },
        timelineClips: [],
        seedClip: { id: 'mc_seed', MediaRef: 'm1', start: 0, end: 10 },
        availableClips: [
          { id: 'mc1', MediaRef: 'm2', start: 0, end: 5 },
          { id: 'mc2', MediaRef: 'm3', start: 10, end: 15 },
        ],
        labelFaces: [],
        labelPeople: [],
        labelObjects: [
          // Seed clip has entity e1
          {
            id: 'lc_seed',
            MediaRef: 'm1',
            start: 2,
            end: 5,
            LabelEntityRef: 'e1',
            confidence: 0.9,
          },
          // mc1 also has entity e1
          {
            id: 'lc_mc1',
            MediaRef: 'm2',
            start: 1,
            end: 3,
            LabelEntityRef: 'e1',
            confidence: 0.8,
          },
        ],
        labelShots: [],
        labelTracks: [],
        labelSpeech: [],
        labelEntities: [{ id: 'e1', canonicalName: 'Car' }],
        searchParams: {},
      });

      // Mock mutators
      (service as any).timelineRecommendationMutator = {
        getTopByQueryHash: vi.fn().mockResolvedValue([]),
        upsert: vi
          .fn()
          .mockImplementation((input) =>
            Promise.resolve({ id: 'rec_id', ...input })
          ),
      };

      const recommendations = await service.getTimelineRecommendations(
        'ws1',
        't1',
        'mc_seed'
      );

      expect(recommendations).toHaveLength(1);
      expect(recommendations[0].MediaClipRef).toBe('mc1');
      expect(recommendations[0].reason).toContain('Shares 1 common entity');
      expect(
        (service as any).timelineRecommendationMutator.upsert
      ).toHaveBeenCalledTimes(1);
    });
  });
});
