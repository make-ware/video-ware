import { useContext } from 'react';
import { TimelineRecommendationContext } from '@/contexts/timeline-recommendation-context';

/**
 * Hook to access timeline recommendation context
 * Must be used within a TimelineRecommendationProvider
 *
 * @returns TimelineRecommendationContext value
 * @throws Error if used outside TimelineRecommendationProvider
 *
 * @example
 * ```tsx
 * function SuggestedNextClips() {
 *   const {
 *     recommendations,
 *     isLoading,
 *     error,
 *     acceptRecommendation,
 *     dismissRecommendation,
 *     selectedStrategies,
 *     filterByStrategy,
 *     clearStrategyFilter
 *   } = useTimelineRecommendations();
 *
 *   if (isLoading) {
 *     return <p>Loading recommendations...</p>;
 *   }
 *
 *   if (error) {
 *     return <p>Error: {error}</p>;
 *   }
 *
 *   return (
 *     <div>
 *       <div>
 *         <button onClick={() => filterByStrategy('same_entity')}>
 *           Toggle Same Entity Filter
 *         </button>
 *         <button onClick={clearStrategyFilter}>
 *           Clear Filters
 *         </button>
 *       </div>
 *       {recommendations.map((rec) => (
 *         <div key={rec.id}>
 *           <p>{rec.reason}</p>
 *           <p>Score: {rec.score}</p>
 *           <button onClick={() => acceptRecommendation(rec.id)}>
 *             Add to Timeline
 *           </button>
 *           <button onClick={() => dismissRecommendation(rec.id)}>
 *             Dismiss
 *           </button>
 *         </div>
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 */
export function useTimelineRecommendations() {
  const context = useContext(TimelineRecommendationContext);

  if (context === undefined) {
    throw new Error(
      'useTimelineRecommendations must be used within a TimelineRecommendationProvider'
    );
  }

  return context;
}
