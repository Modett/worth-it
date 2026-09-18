/**
 * The fixed category vocabulary an item can be filed under.
 *
 * It is deliberately *not* a Postgres enum: the scoring module (step 5) keys
 * its per-category regret weights off these values, and widening a database
 * enum needs a migration on a locked table, whereas adding a member here is a
 * code change plus a scoring-config entry. The column stays `String`, and this
 * list is the single place the allowed values are defined — DTO validation,
 * Swagger and the tests all read it from here.
 *
 * Shaped as a const object rather than a TypeScript `enum` so it matches the
 * enums Prisma generates (`ItemSource`, `ItemStatus`) and can be used
 * interchangeably with them by `@IsEnum()` and `@ApiProperty({ enum })`.
 */
export const ItemCategory = {
  FASHION: 'FASHION',
  BEAUTY: 'BEAUTY',
  HOME: 'HOME',
  ELECTRONICS: 'ELECTRONICS',
  TRAVEL: 'TRAVEL',
  DINING: 'DINING',
  GIFTS: 'GIFTS',
  ENTERTAINMENT: 'ENTERTAINMENT',
  TRANSPORT: 'TRANSPORT',
  OTHER: 'OTHER',
} as const;

export type ItemCategory = (typeof ItemCategory)[keyof typeof ItemCategory];

export const ITEM_CATEGORIES = Object.values(ItemCategory);
