import { ItemSource, ItemStatus, Prisma } from '../../../generated/prisma/client';
import { ItemCategory } from '../item-category';
import { ItemResponseDto, ItemRow } from './item-response.dto';

const ITEM_ID = '33333333-3333-4333-8333-333333333333';
const DISCOVERED_AT = new Date('2026-09-01T08:30:00.000Z');
const CREATED_AT = new Date('2026-09-13T10:00:00.000Z');

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
    discoveredAt: DISCOVERED_AT,
    status: ItemStatus.WISHLIST,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

describe('ItemResponseDto', () => {
  it('serialises every documented field and nothing else', () => {
    expect(ItemResponseDto.fromItem(storedItem())).toEqual({
      id: ITEM_ID,
      source: ItemSource.LINK,
      sourceUrl: 'https://shop.example.com/products/runner-2',
      imageUrl: null,
      productName: 'Runner 2 Trail Shoes',
      brand: 'Nike',
      category: ItemCategory.FASHION,
      price: 129.99,
      detectedSaleLanguage: false,
      discoveredAt: DISCOVERED_AT.toISOString(),
      status: ItemStatus.WISHLIST,
      createdAt: CREATED_AT.toISOString(),
      updatedAt: CREATED_AT.toISOString(),
    });
  });

  it('never exposes the owner, even when the row carries one', () => {
    const withOwner = { ...storedItem(), userId: '11111111-1111-4111-8111-111111111111' };

    expect(ItemResponseDto.fromItem(withOwner)).not.toHaveProperty('userId');
  });

  it('drops a relation the row happens to carry, rather than leaking it', () => {
    // Scoring (step 5) hangs off the same row; @Exclude() means it cannot ride
    // along into a response until it is deliberately exposed here.
    const withScore = { ...storedItem(), regretScore: { score: 72 } };

    expect(ItemResponseDto.fromItem(withScore)).not.toHaveProperty('regretScore');
  });

  it('converts the Decimal price to a number without losing cents', () => {
    const result = ItemResponseDto.fromItem(storedItem({ price: new Prisma.Decimal('1234.56') }));

    expect(result.price).toBe(1234.56);
    expect(typeof result.price).toBe('number');
  });

  it('sends timestamps as ISO 8601 strings, which JSON can carry', () => {
    const result = ItemResponseDto.fromItem(storedItem());

    expect(typeof result.discoveredAt).toBe('string');
    expect(result.discoveredAt).toBe('2026-09-01T08:30:00.000Z');
  });

  it('keeps the nullable fields null rather than dropping the keys', () => {
    const result = ItemResponseDto.fromItem(
      storedItem({ source: ItemSource.MANUAL, sourceUrl: null, brand: null }),
    );

    expect(result.sourceUrl).toBeNull();
    expect(result.brand).toBeNull();
  });
});
