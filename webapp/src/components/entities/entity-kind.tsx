import { EntityKind } from '@project/shared';
import { MapPin, Package, Shapes, UserRound } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/** Display facts for each entity kind: section label and icon. */
export const ENTITY_KIND_META: Record<
  EntityKind,
  { label: string; icon: LucideIcon }
> = {
  [EntityKind.PERSON]: { label: 'People', icon: UserRound },
  [EntityKind.PLACE]: { label: 'Places', icon: MapPin },
  [EntityKind.PRODUCT]: { label: 'Products', icon: Package },
  [EntityKind.THING]: { label: 'Things', icon: Shapes },
};

/** Section order on the entities home page. */
export const ENTITY_KIND_ORDER: EntityKind[] = [
  EntityKind.PERSON,
  EntityKind.PLACE,
  EntityKind.PRODUCT,
  EntityKind.THING,
];
