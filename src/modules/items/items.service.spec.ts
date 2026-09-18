import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ItemSource, ItemStatus, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateItemDto } from './dto/create-item.dto';
import { ItemRow } from './dto/item-response.dto';
import { ItemSortField, SortOrder } from './dto/list-items-query.dto';
import {
  InvalidStatusTransitionException,
  ItemNotDeletableException,
  ItemNotEditableException,
  ItemNotFoundException,
} from './exceptions/items.exceptions';
import { ITEMS_CONFIG, RequestedItemStatus } from './items.config';
import { ItemCategory } from './item-category';
import { ItemsService } from './items.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_USER_ID = '22222222-2222-4222-8222-222222222222';
const ITEM_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_ITEM_ID = '44444444-4444-4444-8444-444444444444';
const TIMESTAMP = new Date('2026-09-13T10:00:00.000Z');

/**
 * The lifecycle the module promises, written out here independently of
 * ITEMS_CONFIG so that a change to the table is a test failure rather than a
 * silently agreeing pair of copies.
 */
const EXPECTED_TRANSITIONS: Record<ItemStatus, readonly ItemStatus[]> = {
  WISHLIST: [ItemStatus.PURCHASED, ItemStatus.SKIPPED],
  PAUSED: [ItemStatus.PURCHASED, ItemStatus.SKIPPED],
  PURCHASED: [ItemStatus.RETURNED],
  SKIPPED: [],
  RETURNED: [],
};

/** Every (current status, requested status) pair the endpoint can be asked for. */
const TRANSITION_CASES: { from: ItemStatus; to: RequestedItemStatus; allowed: boolean }[] =
  Object.values(ItemStatus).flatMap((from) =>
    ITEMS_CONFIG.requestableStatuses.map((to) => ({
      from,
      to,
      allowed: EXPECTED_TRANSITIONS[from].includes(to),
    })),
  );

type ItemDelegate = {
  create: jest.Mock;
  findMany: jest.Mock;
  findFirst: jest.Mock;
  update: jest.Mock;
  delete: jest.Mock;
};

interface FindManyArgs {
  where: { userId: string; status?: ItemStatus; category?: ItemCategory };
  orderBy: Record<string, SortOrder>[];
  take: number;
  skip?: number;
  cursor?: { id: string };
}

describe('ItemsService', () => {
  let service: ItemsService;
  let itemDelegate: ItemDelegate;
  let transactionClient: { item: ItemDelegate };
  let prismaService: { item: ItemDelegate; $transaction: jest.Mock };

  beforeEach(async () => {
    itemDelegate = {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };
    transactionClient = { item: itemDelegate };

    prismaService = {
      item: itemDelegate,
      // Interactive transactions run the callback against the same mock, and a
      // throw inside it propagates just as a real rollback would.
      $transaction: jest.fn((callback: (tx: typeof transactionClient) => Promise<unknown>) =>
        callback(transactionClient),
      ),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [ItemsService, { provide: PrismaService, useValue: prismaService }],
    }).compile();

    service = moduleRef.get(ItemsService);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function storedItem(overrides: Partial<ItemRow> = {}): ItemRow {
    return {
      id: ITEM_ID,
      source: ItemSource.LINK,
      sourceUrl: 'https://shop.example.com/products/runner-2',
      imageUrl: null,
      productName: 'Runner 2 Trail Shoes',
      brand: 'Nike',
      category: ItemCategory.FASHION,
      price: new Prisma.Decimal('129.99'),
      detectedSaleLanguage: false,
      discoveredAt: TIMESTAMP,
      status: ItemStatus.WISHLIST,
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
      ...overrides,
    };
  }

  function linkDto(overrides: Partial<CreateItemDto> = {}): CreateItemDto {
    return {
      source: ItemSource.LINK,
      sourceUrl: 'https://shop.example.com/products/runner-2',
      productName: 'Runner 2 Trail Shoes',
      brand: 'Nike',
      category: ItemCategory.FASHION,
      price: 129.99,
      ...overrides,
    };
  }

  /** The `data` Prisma was asked to write on the most recent create. */
  function createdData(): Record<string, unknown> {
    const [[args]] = itemDelegate.create.mock.calls as [[{ data: Record<string, unknown> }]];
    return args.data;
  }

  function findManyArgs(): FindManyArgs {
    const [[args]] = itemDelegate.findMany.mock.calls as [[FindManyArgs]];
    return args;
  }

  /**
   * Stands in for the database on the ownership tests: rows carry an owner and
   * the mocks honour the `userId` in the query, so "only the caller's items"
   * is proven by the query rather than assumed from a hand-picked return value.
   */
  function seedOwnedItems(rows: { userId: string; item: ItemRow }[]): void {
    itemDelegate.findFirst.mockImplementation(
      ({ where }: { where: { id: string; userId: string } }) =>
        Promise.resolve(
          rows.find((row) => row.item.id === where.id && row.userId === where.userId)?.item ?? null,
        ),
    );

    itemDelegate.findMany.mockImplementation(({ where, take }: FindManyArgs) =>
      Promise.resolve(
        rows
          .filter((row) => row.userId === where.userId)
          .map((row) => row.item)
          .slice(0, take),
      ),
    );
  }

  describe('create', () => {
    it('stores a LINK item against the caller, starting in WISHLIST', async () => {
      itemDelegate.create.mockResolvedValue(storedItem());

      const result = await service.create(USER_ID, linkDto());

      expect(createdData()).toMatchObject({
        userId: USER_ID,
        source: ItemSource.LINK,
        sourceUrl: 'https://shop.example.com/products/runner-2',
        productName: 'Runner 2 Trail Shoes',
        brand: 'Nike',
        category: ItemCategory.FASHION,
        price: 129.99,
        status: ItemStatus.WISHLIST,
      });
      expect(result).toMatchObject({ id: ITEM_ID, status: ItemStatus.WISHLIST, price: 129.99 });
    });

    it('takes the owner from the caller, never from the payload', async () => {
      itemDelegate.create.mockResolvedValue(storedItem());

      // `userId` is not on the DTO; this is the shape a client would have to
      // smuggle past validation for the service to be the last line of defence.
      await service.create(USER_ID, {
        ...linkDto(),
        userId: OTHER_USER_ID,
      } as CreateItemDto & { userId: string });

      expect(createdData()).toMatchObject({ userId: USER_ID });
    });

    it('never gives a MANUAL item a source URL, whatever the caller passed', async () => {
      itemDelegate.create.mockResolvedValue(
        storedItem({ source: ItemSource.MANUAL, sourceUrl: null }),
      );

      const result = await service.create(USER_ID, {
        source: ItemSource.MANUAL,
        sourceUrl: 'https://shop.example.com/products/runner-2',
        productName: 'Runner 2 Trail Shoes',
        category: ItemCategory.FASHION,
        price: 129.99,
      });

      expect(createdData()).toMatchObject({ source: ItemSource.MANUAL, sourceUrl: null });
      expect(result.sourceUrl).toBeNull();
    });

    it('stores an absent URL as null rather than leaving the column unset', async () => {
      itemDelegate.create.mockResolvedValue(storedItem({ sourceUrl: null }));

      // The DTO will not let a LINK item through without a URL; this keeps the
      // written row well-formed rather than relying on Prisma's own defaulting.
      await service.create(USER_ID, linkDto({ sourceUrl: undefined }));

      expect(createdData()).toMatchObject({ sourceUrl: null });
    });

    it('stores a missing brand as null rather than undefined', async () => {
      itemDelegate.create.mockResolvedValue(storedItem({ brand: null }));

      await service.create(USER_ID, linkDto({ brand: undefined }));

      expect(createdData()).toMatchObject({ brand: null });
    });

    it('stores a SCREENSHOT item with its image URL and sale-language flag', async () => {
      itemDelegate.create.mockResolvedValue(
        storedItem({
          source: ItemSource.SCREENSHOT,
          sourceUrl: null,
          imageUrl: 'https://cdn.example.test/shot.jpg',
          detectedSaleLanguage: true,
        }),
      );

      const result = await service.create(USER_ID, {
        source: ItemSource.SCREENSHOT,
        imageUrl: 'https://cdn.example.test/shot.jpg',
        productName: 'Runner 2 Trail Shoes',
        category: ItemCategory.FASHION,
        price: 129.99,
        detectedSaleLanguage: true,
      });

      expect(createdData()).toMatchObject({
        source: ItemSource.SCREENSHOT,
        sourceUrl: null,
        imageUrl: 'https://cdn.example.test/shot.jpg',
        detectedSaleLanguage: true,
        status: ItemStatus.WISHLIST,
      });
      expect(result.imageUrl).toBe('https://cdn.example.test/shot.jpg');
    });

    it('never gives a LINK item an image URL, whatever the caller passed', async () => {
      itemDelegate.create.mockResolvedValue(storedItem());

      await service.create(USER_ID, {
        ...linkDto(),
        imageUrl: 'https://cdn.example.test/shot.jpg',
      });

      expect(createdData()).toMatchObject({ imageUrl: null });
    });

    it('defaults discoveredAt to the moment of creation', async () => {
      itemDelegate.create.mockResolvedValue(storedItem());
      const before = Date.now();

      await service.create(USER_ID, linkDto());

      const { discoveredAt } = createdData() as { discoveredAt: Date };
      expect(discoveredAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(discoveredAt.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('keeps a discoveredAt the client supplied', async () => {
      itemDelegate.create.mockResolvedValue(storedItem());
      const discoveredAt = new Date('2026-09-01T08:30:00.000Z');

      await service.create(USER_ID, linkDto({ discoveredAt }));

      expect(createdData()).toMatchObject({ discoveredAt });
    });

    it('logs identifiers only, never what the user is buying or what it costs', async () => {
      itemDelegate.create.mockResolvedValue(storedItem());

      await service.create(USER_ID, linkDto());

      const logged = JSON.stringify((Logger.prototype.log as jest.Mock).mock.calls as unknown[][]);
      expect(logged).toContain(ITEM_ID);
      expect(logged).not.toContain('Runner 2 Trail Shoes');
      expect(logged).not.toContain('129.99');
    });
  });

  describe('list', () => {
    beforeEach(() => {
      itemDelegate.findMany.mockResolvedValue([]);
    });

    it('scopes the query to the caller and defaults to newest discovery first', async () => {
      await service.list(USER_ID, {});

      expect(findManyArgs()).toMatchObject({
        where: { userId: USER_ID, status: undefined, category: undefined },
        orderBy: [{ discoveredAt: SortOrder.DESC }, { id: SortOrder.DESC }],
        // One more than the page size, to detect a following page.
        take: ITEMS_CONFIG.pagination.defaultPageSize + 1,
      });
      expect(findManyArgs().cursor).toBeUndefined();
      expect(findManyArgs().skip).toBeUndefined();
    });

    it('passes the status and category filters through to the query', async () => {
      await service.list(USER_ID, {
        status: ItemStatus.PURCHASED,
        category: ItemCategory.ELECTRONICS,
      });

      expect(findManyArgs().where).toEqual({
        userId: USER_ID,
        status: ItemStatus.PURCHASED,
        category: ItemCategory.ELECTRONICS,
      });
    });

    it.each([
      [ItemSortField.DISCOVERED_AT, SortOrder.ASC, { discoveredAt: SortOrder.ASC }],
      [ItemSortField.DISCOVERED_AT, SortOrder.DESC, { discoveredAt: SortOrder.DESC }],
      [ItemSortField.PRICE, SortOrder.ASC, { price: SortOrder.ASC }],
      [ItemSortField.PRICE, SortOrder.DESC, { price: SortOrder.DESC }],
    ])('orders by %s %s, with id as the tie-breaker', async (sortBy, order, expectedPrimary) => {
      await service.list(USER_ID, { sortBy, order });

      expect(findManyArgs().orderBy).toEqual([expectedPrimary, { id: order }]);
    });

    it('honours a requested page size', async () => {
      await service.list(USER_ID, { limit: 5 });

      expect(findManyArgs().take).toBe(6);
    });

    it('seeks past the cursor row rather than returning it again', async () => {
      await service.list(USER_ID, { cursor: OTHER_ITEM_ID });

      expect(findManyArgs()).toMatchObject({ cursor: { id: OTHER_ITEM_ID }, skip: 1 });
    });

    it('reports a following page and hands back the marker to resume from', async () => {
      const rows = [
        storedItem({ id: ITEM_ID }),
        storedItem({ id: OTHER_ITEM_ID }),
        storedItem({ id: '55555555-5555-4555-8555-555555555555' }),
      ];
      itemDelegate.findMany.mockResolvedValue(rows);

      const page = await service.list(USER_ID, { limit: 2 });

      // The extra row is the signal, not part of the page.
      expect(page.data.map((item) => item.id)).toEqual([ITEM_ID, OTHER_ITEM_ID]);
      expect(page.hasMore).toBe(true);
      expect(page.nextCursor).toBe(OTHER_ITEM_ID);
    });

    it('closes the sequence when the last page comes back short', async () => {
      itemDelegate.findMany.mockResolvedValue([storedItem()]);

      const page = await service.list(USER_ID, { limit: 2 });

      expect(page.data).toHaveLength(1);
      expect(page.hasMore).toBe(false);
      expect(page.nextCursor).toBeNull();
    });

    it('returns an empty page rather than failing when the user has no items', async () => {
      await expect(service.list(USER_ID, {})).resolves.toEqual({
        data: [],
        nextCursor: null,
        hasMore: false,
      });
    });

    it("returns only the caller's items when another user has items too", async () => {
      seedOwnedItems([
        { userId: USER_ID, item: storedItem({ id: ITEM_ID }) },
        { userId: OTHER_USER_ID, item: storedItem({ id: OTHER_ITEM_ID }) },
      ]);

      const page = await service.list(USER_ID, {});

      expect(page.data.map((item) => item.id)).toEqual([ITEM_ID]);
    });
  });

  describe('findOne', () => {
    it('returns the item when it belongs to the caller', async () => {
      seedOwnedItems([{ userId: USER_ID, item: storedItem() }]);

      await expect(service.findOne(USER_ID, ITEM_ID)).resolves.toMatchObject({ id: ITEM_ID });
    });

    it('reports an unknown id as not found', async () => {
      seedOwnedItems([]);

      await expect(service.findOne(USER_ID, ITEM_ID)).rejects.toThrow(ItemNotFoundException);
    });

    it("reports another user's item as not found rather than forbidden", async () => {
      seedOwnedItems([{ userId: OTHER_USER_ID, item: storedItem() }]);

      await expect(service.findOne(USER_ID, ITEM_ID)).rejects.toThrow(ItemNotFoundException);
    });
  });

  describe('update', () => {
    function updateArgs(): { where: Record<string, unknown>; data: Record<string, unknown> } {
      const [[args]] = itemDelegate.update.mock.calls as [
        [{ where: Record<string, unknown>; data: Record<string, unknown> }],
      ];
      return args;
    }

    it.each([ItemStatus.WISHLIST, ItemStatus.PAUSED])(
      'edits the descriptive fields of a %s item',
      async (status) => {
        seedOwnedItems([{ userId: USER_ID, item: storedItem({ status }) }]);
        itemDelegate.update.mockResolvedValue(storedItem({ status, productName: 'Runner 3' }));

        const result = await service.update(USER_ID, ITEM_ID, {
          productName: 'Runner 3',
          category: ItemCategory.ELECTRONICS,
          price: 99.5,
        });

        expect(updateArgs().data).toEqual({
          productName: 'Runner 3',
          brand: undefined,
          category: ItemCategory.ELECTRONICS,
          price: 99.5,
        });
        expect(result.productName).toBe('Runner 3');
      },
    );

    it('leaves omitted fields alone by passing undefined, which Prisma skips', async () => {
      seedOwnedItems([{ userId: USER_ID, item: storedItem() }]);
      itemDelegate.update.mockResolvedValue(storedItem());

      await service.update(USER_ID, ITEM_ID, { price: 99.5 });

      expect(updateArgs().data).toEqual({
        productName: undefined,
        brand: undefined,
        category: undefined,
        price: 99.5,
      });
    });

    it('clears a brand when null is sent explicitly', async () => {
      seedOwnedItems([{ userId: USER_ID, item: storedItem() }]);
      itemDelegate.update.mockResolvedValue(storedItem({ brand: null }));

      const result = await service.update(USER_ID, ITEM_ID, { brand: null });

      expect(updateArgs().data).toMatchObject({ brand: null });
      expect(result.brand).toBeNull();
    });

    it.each([ItemStatus.PURCHASED, ItemStatus.SKIPPED, ItemStatus.RETURNED])(
      'refuses to edit a %s item and writes nothing',
      async (status) => {
        seedOwnedItems([{ userId: USER_ID, item: storedItem({ status }) }]);

        await expect(service.update(USER_ID, ITEM_ID, { price: 99.5 })).rejects.toThrow(
          ItemNotEditableException,
        );
        expect(itemDelegate.update).not.toHaveBeenCalled();
      },
    );

    it('names the blocking status in the error, so the client can explain it', async () => {
      seedOwnedItems([{ userId: USER_ID, item: storedItem({ status: ItemStatus.PURCHASED }) }]);

      await expect(service.update(USER_ID, ITEM_ID, { price: 99.5 })).rejects.toThrow(/PURCHASED/);
    });

    it("reports another user's item as not found and writes nothing", async () => {
      seedOwnedItems([{ userId: OTHER_USER_ID, item: storedItem() }]);

      await expect(service.update(USER_ID, ITEM_ID, { price: 99.5 })).rejects.toThrow(
        ItemNotFoundException,
      );
      expect(itemDelegate.update).not.toHaveBeenCalled();
    });

    it('reads and writes inside one transaction, so the state check cannot go stale', async () => {
      seedOwnedItems([{ userId: USER_ID, item: storedItem() }]);
      itemDelegate.update.mockResolvedValue(storedItem());

      await service.update(USER_ID, ITEM_ID, { price: 99.5 });

      expect(prismaService.$transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('updateStatus', () => {
    const allowedCases = TRANSITION_CASES.filter((testCase) => testCase.allowed);
    const rejectedCases = TRANSITION_CASES.filter((testCase) => !testCase.allowed);

    it('covers every status against every requestable target', () => {
      expect(TRANSITION_CASES).toHaveLength(
        Object.keys(ItemStatus).length * ITEMS_CONFIG.requestableStatuses.length,
      );
      expect(allowedCases).toHaveLength(5);
    });

    it.each(allowedCases)('allows $from -> $to', async ({ from, to }) => {
      seedOwnedItems([{ userId: USER_ID, item: storedItem({ status: from }) }]);
      itemDelegate.update.mockResolvedValue(storedItem({ status: to }));

      const result = await service.updateStatus(USER_ID, ITEM_ID, { status: to });

      expect(itemDelegate.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: ITEM_ID }, data: { status: to } }),
      );
      expect(result.status).toBe(to);
    });

    it.each(rejectedCases)('rejects $from -> $to and writes nothing', async ({ from, to }) => {
      seedOwnedItems([{ userId: USER_ID, item: storedItem({ status: from }) }]);

      await expect(service.updateStatus(USER_ID, ITEM_ID, { status: to })).rejects.toThrow(
        InvalidStatusTransitionException,
      );
      expect(itemDelegate.update).not.toHaveBeenCalled();
    });

    it.each(rejectedCases)('names both ends of the rejected $from -> $to', async ({ from, to }) => {
      seedOwnedItems([{ userId: USER_ID, item: storedItem({ status: from }) }]);

      await expect(service.updateStatus(USER_ID, ITEM_ID, { status: to })).rejects.toThrow(
        new RegExp(`${from}.*${to}`),
      );
    });

    it("reports another user's item as not found and writes nothing", async () => {
      seedOwnedItems([{ userId: OTHER_USER_ID, item: storedItem() }]);

      await expect(
        service.updateStatus(USER_ID, ITEM_ID, { status: ItemStatus.PURCHASED }),
      ).rejects.toThrow(ItemNotFoundException);
      expect(itemDelegate.update).not.toHaveBeenCalled();
    });

    it('logs both ends of the transition with identifiers only', async () => {
      seedOwnedItems([{ userId: USER_ID, item: storedItem() }]);
      itemDelegate.update.mockResolvedValue(storedItem({ status: ItemStatus.PURCHASED }));

      await service.updateStatus(USER_ID, ITEM_ID, { status: ItemStatus.PURCHASED });

      expect(Logger.prototype.log).toHaveBeenCalledWith(
        { userId: USER_ID, itemId: ITEM_ID, from: ItemStatus.WISHLIST, to: ItemStatus.PURCHASED },
        expect.stringContaining('status'),
      );
    });
  });

  describe('remove', () => {
    it('deletes an item that is still on the wishlist', async () => {
      seedOwnedItems([{ userId: USER_ID, item: storedItem() }]);

      await expect(service.remove(USER_ID, ITEM_ID)).resolves.toBeUndefined();

      expect(itemDelegate.delete).toHaveBeenCalledWith({ where: { id: ITEM_ID } });
    });

    it.each([ItemStatus.PAUSED, ItemStatus.PURCHASED, ItemStatus.SKIPPED, ItemStatus.RETURNED])(
      'keeps a %s item, because it is history rather than a mis-entry',
      async (status) => {
        seedOwnedItems([{ userId: USER_ID, item: storedItem({ status }) }]);

        await expect(service.remove(USER_ID, ITEM_ID)).rejects.toThrow(ItemNotDeletableException);
        expect(itemDelegate.delete).not.toHaveBeenCalled();
      },
    );

    it("reports another user's item as not found and deletes nothing", async () => {
      seedOwnedItems([{ userId: OTHER_USER_ID, item: storedItem() }]);

      await expect(service.remove(USER_ID, ITEM_ID)).rejects.toThrow(ItemNotFoundException);
      expect(itemDelegate.delete).not.toHaveBeenCalled();
    });

    it('reports an unknown id as not found', async () => {
      seedOwnedItems([]);

      await expect(service.remove(USER_ID, ITEM_ID)).rejects.toThrow(ItemNotFoundException);
    });
  });
});
