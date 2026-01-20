import { render, screen } from '@testing-library/react';
import { MediaRecommendationCard } from '../media-recommendation-card';
import {
  MediaRecommendation,
  LabelType,
  RecommendationStrategy,
} from '@project/shared';
import { describe, it, expect } from 'vitest';

describe('MediaRecommendationCard', () => {
  const mockRecommendation: MediaRecommendation = {
    id: 'rec1',
    WorkspaceRef: 'ws1',
    MediaRef: 'media1',
    start: 10,
    end: 20,
    score: 0.9,
    rank: 1,
    reason: 'Test reason',
    reasonData: {},
    strategy: RecommendationStrategy.ACTIVITY_STRATEGY,
    labelType: LabelType.OBJECT,
    queryHash: 'hash1',
    version: 1,
    expand: {},
    created: '2023-01-01',
    updated: '2023-01-01',
    collectionId: 'col1',
    collectionName: 'MediaRecommendations',
  };

  it('renders checkmark when associated clips exist', () => {
    const recWithClips = {
      ...mockRecommendation,
      expand: {
        MediaClipsRef: [{ id: 'clip1' }],
      },
    } as unknown as MediaRecommendation;

    render(<MediaRecommendationCard recommendation={recWithClips} />);

    // Check for the check icon container or title
    const checkIcon = screen.getByTitle('Clip created');
    expect(checkIcon).toBeInTheDocument();
  });

  it('does not render checkmark when no associated clips', () => {
    render(<MediaRecommendationCard recommendation={mockRecommendation} />);

    const checkIcon = screen.queryByTitle('Clip created');
    expect(checkIcon).not.toBeInTheDocument();
  });
});
