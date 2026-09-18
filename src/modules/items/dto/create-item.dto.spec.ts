import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import { ItemSource } from '../../../generated/prisma/client';
import { ITEM_CATEGORIES, ItemCategory } from '../item-category';
import { ITEMS_CONFIG } from '../items.config';
import { CreateItemDto } from './create-item.dto';

const VALID_URL = 'https://shop.example.com/products/runner-2';

/**
 * The input rules for a new item live on this DTO and nowhere else, so they are
 * asserted here — at the single place they are enforced — rather than being
 * duplicated as defensive checks in ItemsService.
 */
function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    source: ItemSource.LINK,
    sourceUrl: VALID_URL,
    productName: 'Runner 2 Trail Shoes',
    brand: 'Nike',
    category: ItemCategory.FASHION,
    price: 129.99,
    ...overrides,
  };
}

async function failedProperties(input: Record<string, unknown>): Promise<string[]> {
  const errors: ValidationError[] = await validate(plainToInstance(CreateItemDto, input));
  return errors.map((error) => error.property).sort();
}

async function messagesFor(input: Record<string, unknown>, property: string): Promise<string[]> {
  const errors: ValidationError[] = await validate(plainToInstance(CreateItemDto, input));
  const match = errors.find((error) => error.property === property);
  return Object.values(match?.constraints ?? {});
}

describe('CreateItemDto', () => {
  it('accepts a complete LINK item', async () => {
    await expect(failedProperties(payload())).resolves.toEqual([]);
  });

  it('accepts a MANUAL item with no URL', async () => {
    await expect(
      failedProperties(payload({ source: ItemSource.MANUAL, sourceUrl: undefined })),
    ).resolves.toEqual([]);
  });

  describe('source', () => {
    it.each([ItemSource.LINK, ItemSource.MANUAL, ItemSource.SCREENSHOT])(
      'accepts %s',
      async (source) => {
        const sourceUrl = source === ItemSource.LINK ? VALID_URL : undefined;
        const imageUrl = source === ItemSource.SCREENSHOT ? VALID_URL : undefined;
        await expect(failedProperties(payload({ source, sourceUrl, imageUrl }))).resolves.toEqual(
          [],
        );
      },
    );

    it.each([
      ['an unknown source', 'IMPORTED'],
      ['lower case', 'link'],
      ['a number', 2],
    ])('rejects %s', async (_case, source) => {
      await expect(failedProperties(payload({ source, sourceUrl: undefined }))).resolves.toContain(
        'source',
      );
    });

    it('rejects a missing source', async () => {
      await expect(
        failedProperties(payload({ source: undefined, sourceUrl: undefined })),
      ).resolves.toEqual(['source']);
    });
  });

  describe('sourceUrl', () => {
    it('is required for a LINK item', async () => {
      await expect(failedProperties(payload({ sourceUrl: undefined }))).resolves.toEqual([
        'sourceUrl',
      ]);
      await expect(messagesFor(payload({ sourceUrl: undefined }), 'sourceUrl')).resolves.toEqual([
        'sourceUrl is required when source is LINK',
      ]);
    });

    it('is rejected outright for a MANUAL item, rather than quietly dropped', async () => {
      const manual = payload({ source: ItemSource.MANUAL, sourceUrl: VALID_URL });

      await expect(failedProperties(manual)).resolves.toEqual(['sourceUrl']);
      await expect(messagesFor(manual, 'sourceUrl')).resolves.toEqual([
        'sourceUrl is only allowed when source is LINK',
      ]);
    });

    it.each([
      ['an explicit null', null],
      ['an empty string', ''],
      ['no scheme', 'shop.example.com/products/runner-2'],
      ['a scheme we would never fetch', 'javascript:alert(1)'],
      ['an ftp link', 'ftp://shop.example.com/runner-2'],
      ['not a URL at all', 'just some text'],
      ['a number', 42],
    ])('rejects %s on a LINK item', async (_case, sourceUrl) => {
      await expect(failedProperties(payload({ sourceUrl }))).resolves.toEqual(['sourceUrl']);
    });

    it('rejects a URL longer than the ceiling', async () => {
      const tooLong = `https://shop.example.com/${'a'.repeat(ITEMS_CONFIG.sourceUrl.maxLength)}`;

      await expect(failedProperties(payload({ sourceUrl: tooLong }))).resolves.toEqual([
        'sourceUrl',
      ]);
    });

    it('accepts a plain http URL', async () => {
      await expect(
        failedProperties(payload({ sourceUrl: 'http://shop.example.com/runner-2' })),
      ).resolves.toEqual([]);
    });
  });

  describe('imageUrl', () => {
    const screenshot = payload({
      source: ItemSource.SCREENSHOT,
      sourceUrl: undefined,
      imageUrl: VALID_URL,
    });

    it('is required for a SCREENSHOT item', async () => {
      await expect(failedProperties({ ...screenshot, imageUrl: undefined })).resolves.toEqual([
        'imageUrl',
      ]);
      await expect(
        messagesFor({ ...screenshot, imageUrl: undefined }, 'imageUrl'),
      ).resolves.toEqual(['imageUrl is required when source is SCREENSHOT']);
    });

    it('is rejected outright for a LINK item, rather than quietly dropped', async () => {
      await expect(failedProperties(payload({ imageUrl: VALID_URL }))).resolves.toEqual([
        'imageUrl',
      ]);
      await expect(messagesFor(payload({ imageUrl: VALID_URL }), 'imageUrl')).resolves.toEqual([
        'imageUrl is only allowed when source is SCREENSHOT',
      ]);
    });

    it('is rejected for a MANUAL item', async () => {
      await expect(
        failedProperties(
          payload({ source: ItemSource.MANUAL, sourceUrl: undefined, imageUrl: VALID_URL }),
        ),
      ).resolves.toEqual(['imageUrl']);
    });

    it('accepts a complete SCREENSHOT item', async () => {
      await expect(failedProperties(screenshot)).resolves.toEqual([]);
    });
  });

  describe('productName', () => {
    it('trims surrounding whitespace before the length rules apply', async () => {
      const dto = plainToInstance(CreateItemDto, payload({ productName: '  Runner 2  ' }));

      expect(dto.productName).toBe('Runner 2');
      await expect(validate(dto)).resolves.toEqual([]);
    });

    it.each([
      ['an empty string', ''],
      ['whitespace only', '   '],
      ['a number', 7],
      ['a missing name', undefined],
    ])('rejects %s', async (_case, productName) => {
      await expect(failedProperties(payload({ productName }))).resolves.toEqual(['productName']);
    });

    it('accepts a name at the ceiling and rejects one character more', async () => {
      const atLimit = 'a'.repeat(ITEMS_CONFIG.productName.maxLength);

      await expect(failedProperties(payload({ productName: atLimit }))).resolves.toEqual([]);
      await expect(failedProperties(payload({ productName: `${atLimit}a` }))).resolves.toEqual([
        'productName',
      ]);
    });
  });

  describe('brand', () => {
    it.each([
      ['an omitted brand', undefined],
      ['an explicit null', null],
    ])('accepts %s, since not every item has one', async (_case, brand) => {
      await expect(failedProperties(payload({ brand }))).resolves.toEqual([]);
    });

    it('accepts a brand at the ceiling and rejects one character more', async () => {
      const atLimit = 'a'.repeat(ITEMS_CONFIG.brand.maxLength);

      await expect(failedProperties(payload({ brand: atLimit }))).resolves.toEqual([]);
      await expect(failedProperties(payload({ brand: `${atLimit}a` }))).resolves.toEqual(['brand']);
    });

    it('trims a padded brand', () => {
      expect(plainToInstance(CreateItemDto, payload({ brand: ' Nike ' })).brand).toBe('Nike');
    });
  });

  describe('category', () => {
    it.each(ITEM_CATEGORIES)('accepts %s', async (category) => {
      await expect(failedProperties(payload({ category }))).resolves.toEqual([]);
    });

    it.each([
      ['a category outside the vocabulary', 'GROCERIES'],
      ['lower case', 'fashion'],
      ['an empty string', ''],
      ['a missing category', undefined],
    ])('rejects %s', async (_case, category) => {
      await expect(failedProperties(payload({ category }))).resolves.toEqual(['category']);
    });
  });

  describe('price', () => {
    it.each([ITEMS_CONFIG.price.min, 129.99, 1000, ITEMS_CONFIG.price.max])(
      'accepts %s',
      async (price) => {
        await expect(failedProperties(payload({ price }))).resolves.toEqual([]);
      },
    );

    it.each([
      ['zero', 0],
      ['a negative price', -1],
      ['above the ceiling', ITEMS_CONFIG.price.max + 0.01],
      ['an order of magnitude too large', 100_000_000],
      // Decimal(12, 2) would silently round this, so it is rejected instead.
      ['more than two decimal places', 10.123],
      ['a numeric string', '129.99'],
      ['not a number at all', 'cheap'],
      ['a missing price', undefined],
    ])('rejects %s', async (_case, price) => {
      await expect(failedProperties(payload({ price }))).resolves.toEqual(['price']);
    });
  });

  describe('discoveredAt', () => {
    it('is optional, defaulting later to the moment of creation', async () => {
      await expect(failedProperties(payload({ discoveredAt: undefined }))).resolves.toEqual([]);
    });

    it('accepts an ISO 8601 timestamp in the past', async () => {
      await expect(
        failedProperties(payload({ discoveredAt: '2026-09-01T08:30:00.000Z' })),
      ).resolves.toEqual([]);
    });

    it('rejects a timestamp in the future', async () => {
      const future = new Date(Date.now() + 60_000).toISOString();

      await expect(failedProperties(payload({ discoveredAt: future }))).resolves.toEqual([
        'discoveredAt',
      ]);
      await expect(messagesFor(payload({ discoveredAt: future }), 'discoveredAt')).resolves.toEqual(
        ['discoveredAt cannot be in the future'],
      );
    });

    it.each([
      ['an unparseable string', 'yesterday'],
      ['an explicit null', null],
    ])('rejects %s', async (_case, discoveredAt) => {
      await expect(failedProperties(payload({ discoveredAt }))).resolves.toEqual(['discoveredAt']);
    });
  });
});
