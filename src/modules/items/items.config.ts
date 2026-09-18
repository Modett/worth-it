import { ItemSource, ItemStatus } from '../../generated/prisma/client';

/**
 * The lifecycle an item may move through, as an explicit table rather than a
 * chain of `if`s (.cursorrules §3). Every status is a key, including the two
 * terminal ones, so an unlisted transition is a missing entry rather than an
 * unhandled case.
 *
 * PAUSED already has its outward edges even though nothing can currently
 * produce a paused item: the pauses module (step 7) is what moves an item into
 * PAUSED, and when it lands this table needs no change.
 */
const STATUS_TRANSITIONS: Readonly<Record<ItemStatus, readonly ItemStatus[]>> = {
  [ItemStatus.WISHLIST]: [ItemStatus.PURCHASED, ItemStatus.SKIPPED],
  [ItemStatus.PAUSED]: [ItemStatus.PURCHASED, ItemStatus.SKIPPED],
  [ItemStatus.PURCHASED]: [ItemStatus.RETURNED],
  [ItemStatus.SKIPPED]: [],
  [ItemStatus.RETURNED]: [],
};

/**
 * Editing descriptive fields is only meaningful while the purchase decision is
 * still open. Once an item is PURCHASED, SKIPPED or RETURNED its details are
 * history that the ratings and dashboard modules report on.
 */
const EDITABLE_STATUSES: readonly ItemStatus[] = [ItemStatus.WISHLIST, ItemStatus.PAUSED];

/**
 * Hard delete is for a user correcting a mis-entry, not for erasing history: an
 * item that has been through any real lifecycle stays for the regret data.
 */
const DELETABLE_STATUSES: readonly ItemStatus[] = [ItemStatus.WISHLIST];

/**
 * Single versioned source of truth for the items module's tunables
 * (.cursorrules §3). Bump `version` whenever a bound or a lifecycle rule
 * changes, so a widened limit is traceable in git.
 */
export const ITEMS_CONFIG = {
  version: 2,

  productName: {
    /** Whitespace is trimmed first, so this rejects a blank name too. */
    minLength: 1,
    maxLength: 200,
  },

  brand: {
    maxLength: 100,
  },

  sourceUrl: {
    /** Only the schemes a product page can actually be fetched over later. */
    protocols: ['http', 'https'],
    /** The ceiling browsers and proxies converge on for a usable URL. */
    maxLength: 2048,
  },

  imageUrl: {
    protocols: ['http', 'https'],
    maxLength: 2048,
  },

  price: {
    /**
     * The column is Decimal(12, 2), so two places is the finest granularity
     * that survives a round trip; anything smaller would be silently rounded.
     */
    decimalPlaces: 2,
    /** Effectively "> 0" at two decimal places. */
    min: 0.01,
    /** Matches the monthlyBudget ceiling: past this it is a typo, not a price. */
    max: 10_000_000,
  },

  pagination: {
    defaultPageSize: 20,
    /** A hard ceiling, so no client can ask for an unbounded page (§6). */
    maxPageSize: 100,
  },

  /**
   * SCREENSHOT items are produced by POST /items/from-screenshot (auto-create)
   * or confirmed afterwards via POST /items with the stored imageUrl attached.
   */
  creatableSources: [ItemSource.LINK, ItemSource.MANUAL, ItemSource.SCREENSHOT],

  screenshot: {
    fieldName: 'image',
    /** Rejected before the buffer is held; 8MB is a phone screenshot ceiling. */
    maxUploadBytes: 8 * 1024 * 1024,
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  },

  /**
   * This endpoint spends an AI call and an R2 write per request, so it gets
   * the same tight per-IP budget as signup/login rather than the global default.
   */
  screenshotThrottle: {
    limit: 5,
    ttlSeconds: 60,
  },

  /**
   * The statuses a client may ask for on the status endpoint. WISHLIST is only
   * ever the creation state and PAUSED is owned by the pauses module, so
   * neither is requestable here — asking for one fails validation before the
   * state machine is consulted.
   */
  requestableStatuses: [ItemStatus.PURCHASED, ItemStatus.SKIPPED, ItemStatus.RETURNED],

  statusTransitions: STATUS_TRANSITIONS,
  editableStatuses: EDITABLE_STATUSES,
  deletableStatuses: DELETABLE_STATUSES,
} as const;

/** The narrowed source union the create endpoint accepts. */
export type CreatableItemSource = (typeof ITEMS_CONFIG.creatableSources)[number];

/** The narrowed status union the status-transition endpoint accepts. */
export type RequestedItemStatus = (typeof ITEMS_CONFIG.requestableStatuses)[number];

export function canTransitionTo(from: ItemStatus, to: ItemStatus): boolean {
  return ITEMS_CONFIG.statusTransitions[from].includes(to);
}

export function allowsFieldEdits(status: ItemStatus): boolean {
  return ITEMS_CONFIG.editableStatuses.includes(status);
}

export function allowsDeletion(status: ItemStatus): boolean {
  return ITEMS_CONFIG.deletableStatuses.includes(status);
}
