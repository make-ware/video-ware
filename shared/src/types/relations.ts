/**
 * Type helper for expanding relations
 *
 * T: The base record type (without expand)
 * Relations: A map of relation field names to their target record types
 * K: The keys of the relations to expand
 */
export type Expanded<
  T,
  Relations,
  K extends keyof Relations = keyof Relations,
> = [K] extends [never]
  ? T
  : T & {
      expand: Pick<Relations, K>;
    };
