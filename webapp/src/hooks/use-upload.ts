import { useContext } from 'react';
import { UploadContext } from '@/contexts/upload-context';

/**
 * Hook to access upload context
 * Must be used within an UploadProvider
 *
 * @returns UploadContext value
 * @throws Error if used outside UploadProvider
 *
 * @example
 * ```tsx
 * function UploadButton() {
 *   const { uploadFile, uploads, isLoading } = useUpload();
 *
 *   const handleFileSelect = async (file: File) => {
 *     try {
 *       await uploadFile(file);
 *       console.log('Upload started successfully');
 *     } catch (error) {
 *       console.error('Upload failed:', error);
 *     }
 *   };
 *
 *   return (
 *     <div>
 *       <input
 *         type="file"
 *         onChange={(e) => {
 *           const file = e.target.files?.[0];
 *           if (file) handleFileSelect(file);
 *         }}
 *       />
 *       {isLoading && <p>Loading uploads...</p>}
 *       <ul>
 *         {uploads.map((upload) => (
 *           <li key={upload.id}>{upload.name} - {upload.status}</li>
 *         ))}
 *       </ul>
 *     </div>
 *   );
 * }
 * ```
 */
export function useUpload() {
  const context = useContext(UploadContext);

  if (context === undefined) {
    throw new Error('useUpload must be used within an UploadProvider');
  }

  return context;
}
