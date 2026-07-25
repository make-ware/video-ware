/**
 * `--sort` registries, one per list.
 *
 * Option *names* are deliberately the same as the webapp's sort dropdowns
 * (`webapp/src/components/media/media-sort.ts`) so `--sort recent` means the
 * same thing in the CLI and the browser. The webapp's descriptors additionally
 * carry `compare`/`canCompare` for positioning realtime events inside a loaded
 * window; the CLI needs only the server-side `pbSort`, so the two stay separate
 * files and only the vocabulary is shared.
 *
 * Every option ends in a stable tiebreak (`-created`) so equal primary keys
 * don't produce a different order between two requests — otherwise a record
 * can appear on both page 1 and page 2, or on neither.
 */
import type { SortRegistry } from './spec.js';

export const MEDIA_SORTS: SortRegistry = [
  { value: 'recent', description: 'newest first', pbSort: '-created' },
  {
    value: 'name',
    description: 'source filename A→Z',
    pbSort: 'UploadRef.name,-created',
  },
  {
    value: 'duration',
    description: 'longest first',
    pbSort: '-duration,-created',
  },
  {
    value: 'media_time',
    description: 'capture time, newest first',
    pbSort: '-mediaDate,-created',
  },
];

export const UPLOAD_SORTS: SortRegistry = [
  { value: 'recent', description: 'newest first', pbSort: '-created' },
  { value: 'name', description: 'file name A→Z', pbSort: 'name,-created' },
  { value: 'size', description: 'largest first', pbSort: '-size,-created' },
  {
    value: 'status',
    description: 'grouped by status',
    pbSort: 'status,-created',
  },
];

export const TIMELINE_SORTS: SortRegistry = [
  { value: 'recent', description: 'newest first', pbSort: '-created' },
  { value: 'name', description: 'name A→Z', pbSort: 'name,-created' },
  {
    value: 'duration',
    description: 'longest first',
    pbSort: '-duration,-created',
  },
];

export const ENTITY_SORTS: SortRegistry = [
  { value: 'name', description: 'name A→Z', pbSort: 'name,-created' },
  { value: 'recent', description: 'newest first', pbSort: '-created' },
  { value: 'kind', description: 'grouped by kind', pbSort: 'kind,name' },
];

export const CAPTION_SORTS: SortRegistry = [
  { value: 'recent', description: 'newest first', pbSort: '-created' },
  { value: 'name', description: 'name A→Z', pbSort: 'name,-created' },
  {
    value: 'duration',
    description: 'longest first',
    pbSort: '-duration,-created',
  },
];

export const DIRECTORY_SORTS: SortRegistry = [
  { value: 'name', description: 'name A→Z', pbSort: 'name,-created' },
  { value: 'recent', description: 'newest first', pbSort: '-created' },
];

export const MEDIA_CLIP_SORTS: SortRegistry = [
  { value: 'recent', description: 'newest first', pbSort: '-created' },
  {
    value: 'start',
    description: 'earliest source position first',
    pbSort: 'start,-created',
  },
  {
    value: 'duration',
    description: 'longest first',
    pbSort: '-duration,-created',
  },
];

export const WORKSPACE_SORTS: SortRegistry = [
  { value: 'name', description: 'name A→Z', pbSort: 'name,-created' },
  { value: 'recent', description: 'newest first', pbSort: '-created' },
];

/**
 * Time-ranged label rows (`entity words`, `entity appearances`, and the label
 * listings): grouped by media then chronological, which is how a reader
 * consumes them.
 */
export const LABEL_RANGE_SORTS: SortRegistry = [
  {
    value: 'media',
    description: 'grouped by media, then chronological',
    pbSort: 'MediaRef,start',
  },
  { value: 'start', description: 'chronological', pbSort: 'start,MediaRef' },
  {
    value: 'duration',
    description: 'longest first',
    pbSort: '-duration,MediaRef,start',
  },
];

export const TIMELINE_TRACK_SORTS: SortRegistry = [
  { value: 'layer', description: 'layer ascending', pbSort: 'layer' },
  { value: 'recent', description: 'newest first', pbSort: '-created' },
];
