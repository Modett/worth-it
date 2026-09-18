import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import { ItemStatus } from '../../../generated/prisma/client';
import { ITEM_CATEGORIES } from '../item-category';
import { ITEMS_CONFIG } from '../items.config';
import { ItemSortField, ListItemsQueryDto, SortOrder } from './list-items-query.dto';

const CURSOR = '33333333-3333-4333-8333-333333333333';

/** Query strings always arrive as text, which is what these cases pass in. */
async function failedProperties(input: Record<string, unknown>): Promise<string[]> {
  const errors: ValidationError[] = await validate(plainToInstance(ListItemsQueryDto, input));
  return errors.map((error) => error.property);
}

describe('ListItemsQueryDto', () => {
  it('accepts an empty query, leaving every default to the service', async () => {
    await expect(failedProperties({})).resolves.toEqual([]);
  });

  it('accepts a fully specified query', async () => {
    await expect(
      failedProperties({
        status: ItemStatus.WISHLIST,
        category: ITEM_CATEGORIES[0],
        sortBy: ItemSortField.PRICE,
        order: SortOrder.ASC,
        limit: '50',
        cursor: CURSOR,
      }),
    ).resolves.toEqual([]);
  });

  describe('status', () => {
    it.each(Object.values(ItemStatus))('accepts %s as a filter', async (status) => {
      await expect(failedProperties({ status })).resolves.toEqual([]);
    });

    it('rejects a status outside the lifecycle', async () => {
      await expect(failedProperties({ status: 'ARCHIVED' })).resolves.toEqual(['status']);
    });
  });

  describe('category', () => {
    it.each(ITEM_CATEGORIES)('accepts %s as a filter', async (category) => {
      await expect(failedProperties({ category })).resolves.toEqual([]);
    });

    it('rejects a category outside the vocabulary', async () => {
      await expect(failedProperties({ category: 'GROCERIES' })).resolves.toEqual(['category']);
    });
  });

  describe('sortBy and order', () => {
    it.each([ItemSortField.DISCOVERED_AT, ItemSortField.PRICE])(
      'accepts %s as a sort field',
      async (sortBy) => {
        await expect(failedProperties({ sortBy })).resolves.toEqual([]);
      },
    );

    it.each([
      ['a field that is not sortable', 'productName'],
      ['a column we do not expose', 'userId'],
    ])('rejects %s', async (_case, sortBy) => {
      await expect(failedProperties({ sortBy })).resolves.toEqual(['sortBy']);
    });

    it.each([SortOrder.ASC, SortOrder.DESC])('accepts %s', async (order) => {
      await expect(failedProperties({ order })).resolves.toEqual([]);
    });

    it.each([
      ['upper case', 'ASC'],
      ['SQL phrasing', 'ascending'],
    ])('rejects %s', async (_case, order) => {
      await expect(failedProperties({ order })).resolves.toEqual(['order']);
    });
  });

  describe('limit', () => {
    it('converts the query string to a number, since the app-wide pipe will not', async () => {
      const dto = plainToInstance(ListItemsQueryDto, { limit: '20' });

      expect(dto.limit).toBe(20);
      await expect(validate(dto)).resolves.toEqual([]);
    });

    it.each(['1', String(ITEMS_CONFIG.pagination.maxPageSize)])('accepts %s', async (limit) => {
      await expect(failedProperties({ limit })).resolves.toEqual([]);
    });

    it.each([
      ['zero', '0'],
      ['a negative page size', '-1'],
      ['more than the ceiling', String(ITEMS_CONFIG.pagination.maxPageSize + 1)],
      ['a fractional page size', '1.5'],
      ['text', 'all'],
    ])('rejects %s', async (_case, limit) => {
      await expect(failedProperties({ limit })).resolves.toEqual(['limit']);
    });
  });

  describe('cursor', () => {
    it('accepts a marker from a previous page', async () => {
      await expect(failedProperties({ cursor: CURSOR })).resolves.toEqual([]);
    });

    it.each([
      ['a truncated marker', '3333'],
      ['an offset pretending to be a cursor', '20'],
      ['an empty string', ''],
    ])('rejects %s', async (_case, cursor) => {
      await expect(failedProperties({ cursor })).resolves.toEqual(['cursor']);
    });
  });
});
