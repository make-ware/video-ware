import { useContext } from 'react';
import { MediaRecommendationContext } from '@/contexts/media-recommendation-context';

/**
 * Hook to access media recommendation context
 * Must be used within a MediaRecommendationProvider
 *
 * @returns MediaRecommendationContext value
 * @throws Error if used outside MediaRecommendationProvider
 *
 * @example
 * ```tsx
 * function RecommendedSegments() {
 *   const {
 *     recommendations,
 *     isLoading,
 *     selectedLabelTypes,
 *     filterByLabelType,
 *     clearLabelTypeFilter
 *   } = useMediaRecommendations();
 *
 *   if (isLoading) {
 *     return <p>Loading recommendations...</p>;
 *   }
 *
 *   return (
 *     <div>
 *       <div>
 *         <button onClick={() => filterByLabelType('object')}>
 *           Toggle Object Filter
 *         </button>
 *         <button onClick={clearLabelTypeFilter}>
 *           Clear Filters
 *         </button>
 *       </div>
 *       {recommendations.map((rec) => (
 *         <div key={rec.id}>
 *           <p>{rec.reason}</p>
 *           <p>Score: {rec.score}</p>
 *           <p>Time: {rec.start}s - {rec.end}s</p>
 *         </div>
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 */
export function useMediaRecommendations() {
  const context = useContext(MediaRecommendationContext);

  if (context === undefined) {
    throw new Error(
      'useMediaRecommendations must be used within a MediaRecommendationProvider'
    );
  }

  return context;
}
