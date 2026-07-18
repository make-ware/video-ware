import { cn } from '@/lib/utils';

// Same palette as the speaker strip so an entity keeps a familiar hue when
// moving between the speakers page and the label inspectors.
const ENTITY_BADGE_CLASSES = [
  'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30',
  'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  'bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30',
  'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30',
  'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/30',
  'bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30',
  'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/30',
];

const ENTITY_DOT_CLASSES = [
  'bg-blue-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-purple-500',
  'bg-rose-500',
  'bg-cyan-500',
  'bg-orange-500',
  'bg-indigo-500',
];

export function entityBadgeClass(colorIndex: number): string {
  return ENTITY_BADGE_CLASSES[colorIndex % ENTITY_BADGE_CLASSES.length];
}

export function entityDotClass(colorIndex: number): string {
  return ENTITY_DOT_CLASSES[colorIndex % ENTITY_DOT_CLASSES.length];
}

/** Entity id → row display info, keyed by the workspace entity list order. */
export interface EntityDisplay {
  name: string;
  colorIndex: number;
}

interface EntityBadgeProps {
  name: string;
  colorIndex: number;
  className?: string;
}

/**
 * Compact colored chip naming the entity a label is linked to. The color is
 * stable per entity (index in the workspace entity list) so rows belonging
 * to the same entity are recognizable at a glance.
 */
export function EntityBadge({ name, colorIndex, className }: EntityBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded border px-1.5 py-px text-[10px] font-medium min-w-0',
        entityBadgeClass(colorIndex),
        className
      )}
    >
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full shrink-0',
          entityDotClass(colorIndex)
        )}
      />
      <span className="truncate">{name}</span>
    </span>
  );
}
