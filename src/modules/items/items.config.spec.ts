import { ItemSource, ItemStatus } from '../../generated/prisma/client';
import { allowsDeletion, allowsFieldEdits, canTransitionTo, ITEMS_CONFIG } from './items.config';

/**
 * The lifecycle written out independently of the implementation, so that
 * editing ITEMS_CONFIG's table shows up here as a failure rather than as two
 * copies quietly agreeing with each other.
 */
const EXPECTED_TRANSITIONS: Record<ItemStatus, readonly ItemStatus[]> = {
  WISHLIST: [ItemStatus.PURCHASED, ItemStatus.SKIPPED],
  PAUSED: [ItemStatus.PURCHASED, ItemStatus.SKIPPED],
  PURCHASED: [ItemStatus.RETURNED],
  SKIPPED: [],
  RETURNED: [],
};

const EVERY_PAIR = Object.values(ItemStatus).flatMap((from) =>
  Object.values(ItemStatus).map((to) => ({
    from,
    to,
    allowed: EXPECTED_TRANSITIONS[from].includes(to),
  })),
);

describe('ITEMS_CONFIG', () => {
  describe('the status transition table', () => {
    it('has an entry for every status, so no case is simply unhandled', () => {
      expect(Object.keys(ITEMS_CONFIG.statusTransitions).sort()).toEqual(
        Object.values(ItemStatus).sort(),
      );
    });

    it.each(EVERY_PAIR)('$from -> $to is allowed: $allowed', ({ from, to, allowed }) => {
      expect(canTransitionTo(from, to)).toBe(allowed);
    });

    it.each([ItemStatus.SKIPPED, ItemStatus.RETURNED])('%s is final', (status) => {
      expect(ITEMS_CONFIG.statusTransitions[status]).toEqual([]);
    });

    it('keeps PAUSED wired up even though nothing can produce it yet', () => {
      // The pauses module (step 7) is what moves an item into PAUSED; its exits
      // are already here so that landing it needs no change to this table.
      expect(ITEMS_CONFIG.statusTransitions[ItemStatus.PAUSED]).toEqual([
        ItemStatus.PURCHASED,
        ItemStatus.SKIPPED,
      ]);
    });

    it('offers no route into PAUSED or back to WISHLIST', () => {
      const reachable = Object.values(ITEMS_CONFIG.statusTransitions).flat();

      expect(reachable).not.toContain(ItemStatus.PAUSED);
      expect(reachable).not.toContain(ItemStatus.WISHLIST);
    });
  });

  describe('what a client may ask for', () => {
    it('offers the three statuses this module owns', () => {
      expect(ITEMS_CONFIG.requestableStatuses).toEqual([
        ItemStatus.PURCHASED,
        ItemStatus.SKIPPED,
        ItemStatus.RETURNED,
      ]);
    });

    it('accepts SCREENSHOT now that the AI module can produce one', () => {
      expect(ITEMS_CONFIG.creatableSources).toEqual([
        ItemSource.LINK,
        ItemSource.MANUAL,
        ItemSource.SCREENSHOT,
      ]);
    });
  });

  describe('field edits', () => {
    it.each([
      [ItemStatus.WISHLIST, true],
      [ItemStatus.PAUSED, true],
      [ItemStatus.PURCHASED, false],
      [ItemStatus.SKIPPED, false],
      [ItemStatus.RETURNED, false],
    ])('%s allows edits: %s', (status, expected) => {
      expect(allowsFieldEdits(status)).toBe(expected);
    });
  });

  describe('deletion', () => {
    it.each([
      [ItemStatus.WISHLIST, true],
      [ItemStatus.PAUSED, false],
      [ItemStatus.PURCHASED, false],
      [ItemStatus.SKIPPED, false],
      [ItemStatus.RETURNED, false],
    ])('%s allows deletion: %s', (status, expected) => {
      expect(allowsDeletion(status)).toBe(expected);
    });
  });

  describe('bounds', () => {
    it('caps a page below an unbounded read (.cursorrules §6)', () => {
      expect(ITEMS_CONFIG.pagination.defaultPageSize).toBeLessThanOrEqual(
        ITEMS_CONFIG.pagination.maxPageSize,
      );
      expect(ITEMS_CONFIG.pagination.maxPageSize).toBe(100);
    });

    it('keeps the screenshot upload budget tighter than the global default', () => {
      expect(ITEMS_CONFIG.screenshotThrottle.limit).toBeLessThan(100);
      expect(ITEMS_CONFIG.screenshot.maxUploadBytes).toBe(8 * 1024 * 1024);
    });

    it('matches the price granularity to the Decimal(12, 2) column', () => {
      expect(ITEMS_CONFIG.price.decimalPlaces).toBe(2);
      expect(ITEMS_CONFIG.price.min).toBe(0.01);
    });
  });
});
