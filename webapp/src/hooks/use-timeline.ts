import { useContext } from 'react';
import { TimelineContext } from '@/contexts/timeline-context';

/**
 * Hook to access timeline context
 * Must be used within a TimelineProvider
 *
 * @returns TimelineContext value
 * @throws Error if used outside TimelineProvider
 *
 * @example
 * ```tsx
 * function TimelineEditor() {
 *   const {
 *     timeline,
 *     hasUnsavedChanges,
 *     saveTimeline,
 *     addClip,
 *     removeClip
 *   } = useTimeline();
 *
 *   return (
 *     <div>
 *       <h1>{timeline?.name}</h1>
 *       {hasUnsavedChanges && <span>Unsaved changes</span>}
 *       <button onClick={saveTimeline}>Save</button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useTimeline() {
  const context = useContext(TimelineContext);

  if (context === undefined) {
    throw new Error('useTimeline must be used within a TimelineProvider');
  }

  return context;
}
