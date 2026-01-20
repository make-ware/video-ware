import { useContext } from 'react';
import { MediaContext } from '@/contexts/media-context';

/**
 * Hook to access media context
 * Must be used within a MediaProvider
 *
 * @returns MediaContext value
 * @throws Error if used outside MediaProvider
 *
 * @example
 * ```tsx
 * function MediaGallery() {
 *   const { media, isLoading, getMediaById } = useMedia();
 *
 *   if (isLoading) {
 *     return <p>Loading media...</p>;
 *   }
 *
 *   return (
 *     <div>
 *       {media.map((item) => (
 *         <div key={item.id}>
 *           <h3>{item.upload}</h3>
 *           {item.thumbnailUrl && (
 *             <img src={item.thumbnailUrl} alt="Thumbnail" />
 *           )}
 *           <p>Duration: {item.duration}s</p>
 *           <p>Type: {item.mediaType}</p>
 *         </div>
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 */
export function useMedia() {
  const context = useContext(MediaContext);

  if (context === undefined) {
    throw new Error('useMedia must be used within a MediaProvider');
  }

  return context;
}
