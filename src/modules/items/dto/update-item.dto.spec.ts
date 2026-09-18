import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import { ITEM_CATEGORIES, ItemCategory } from '../item-category';
import { ITEMS_CONFIG } from '../items.config';
import { UpdateItemDto } from './update-item.dto';

async function failedProperties(input: Record<string, unknown>): Promise<string[]> {
  const errors: ValidationError[] = await validate(plainToInstance(UpdateItemDto, input));
  return errors.map((error) => error.property).sort();
}

describe('UpdateItemDto', () => {
  it('accepts a patch of every editable field at once', async () => {
    await expect(
      failedProperties({
        productName: 'Runner 3 Trail Shoes',
        brand: 'Nike',
        category: ItemCategory.ELECTRONICS,
        price: 99.5,
      }),
    ).resolves.toEqual([]);
  });

  it('accepts an empty patch, since every field is optional', async () => {
    await expect(failedProperties({})).resolves.toEqual([]);
  });

  it.each(['source', 'sourceUrl', 'discoveredAt', 'status', 'userId'])(
    'has no %s property, so the app-wide pipe rejects it as unknown',
    (property) => {
      expect(new UpdateItemDto()).not.toHaveProperty(property);
    },
  );

  describe('null handling', () => {
    it('clears the brand, which is the one nullable field', async () => {
      await expect(failedProperties({ brand: null })).resolves.toEqual([]);
    });

    it.each(['productName', 'category', 'price'])(
      'rejects a null %s rather than passing it to a non-nullable column',
      async (property) => {
        await expect(failedProperties({ [property]: null })).resolves.toEqual([property]);
      },
    );
  });

  describe('productName', () => {
    it('trims before the length rules apply', async () => {
      const dto = plainToInstance(UpdateItemDto, { productName: '  Runner 3  ' });

      expect(dto.productName).toBe('Runner 3');
      await expect(validate(dto)).resolves.toEqual([]);
    });

    it.each([
      ['an empty string', ''],
      ['whitespace only', '  '],
      ['a number', 7],
      ['longer than the ceiling', 'a'.repeat(ITEMS_CONFIG.productName.maxLength + 1)],
    ])('rejects %s', async (_case, productName) => {
      await expect(failedProperties({ productName })).resolves.toEqual(['productName']);
    });
  });

  describe('brand', () => {
    it('rejects a brand longer than the ceiling', async () => {
      await expect(
        failedProperties({ brand: 'a'.repeat(ITEMS_CONFIG.brand.maxLength + 1) }),
      ).resolves.toEqual(['brand']);
    });
  });

  describe('category', () => {
    it.each(ITEM_CATEGORIES)('accepts %s', async (category) => {
      await expect(failedProperties({ category })).resolves.toEqual([]);
    });

    it.each([
      ['a category outside the vocabulary', 'GROCERIES'],
      ['lower case', 'fashion'],
    ])('rejects %s', async (_case, category) => {
      await expect(failedProperties({ category })).resolves.toEqual(['category']);
    });
  });

  describe('price', () => {
    it.each([ITEMS_CONFIG.price.min, 99.5, ITEMS_CONFIG.price.max])('accepts %s', async (price) => {
      await expect(failedProperties({ price })).resolves.toEqual([]);
    });

    it.each([
      ['zero', 0],
      ['a negative price', -1],
      ['above the ceiling', ITEMS_CONFIG.price.max + 0.01],
      ['more than two decimal places', 10.123],
      ['a numeric string', '99.50'],
    ])('rejects %s', async (_case, price) => {
      await expect(failedProperties({ price })).resolves.toEqual(['price']);
    });
  });
});
