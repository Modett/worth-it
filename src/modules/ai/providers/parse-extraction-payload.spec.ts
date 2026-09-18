import { ItemCategory } from '../../items/item-category';
import { parseModelExtractionPayload } from './parse-extraction-payload';

const VALID = {
  productName: 'Runner 2',
  brand: 'Nike',
  price: 129.99,
  currency: 'usd',
  category: ItemCategory.FASHION,
  detectedSaleLanguage: true,
  saleLanguagePhrases: [' 70% OFF ', ''],
  uncertain: false,
};

describe('parseModelExtractionPayload', () => {
  it('accepts a complete payload and normalises strings', () => {
    expect(parseModelExtractionPayload(VALID)).toEqual({
      productName: 'Runner 2',
      brand: 'Nike',
      price: 129.99,
      currency: 'USD',
      category: ItemCategory.FASHION,
      detectedSaleLanguage: true,
      saleLanguagePhrases: ['70% OFF'],
      uncertain: false,
    });
  });

  it('treats blank strings and unknown categories as null rather than inventing values', () => {
    expect(
      parseModelExtractionPayload({
        ...VALID,
        productName: '  ',
        brand: '',
        currency: 'dollars',
        category: 'GROCERIES',
      }),
    ).toMatchObject({
      productName: null,
      brand: null,
      currency: null,
      category: null,
    });
  });

  it('rejects a missing required shape so the provider retries', () => {
    expect(parseModelExtractionPayload({ productName: 'Runner 2' })).toBeNull();
    expect(parseModelExtractionPayload('not-an-object')).toBeNull();
    expect(parseModelExtractionPayload({ ...VALID, detectedSaleLanguage: 'yes' })).toBeNull();
    expect(parseModelExtractionPayload({ ...VALID, price: 0 })).toMatchObject({ price: null });
  });
});
