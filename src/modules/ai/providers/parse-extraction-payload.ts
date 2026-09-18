import { ITEM_CATEGORIES, ItemCategory } from '../../items/item-category';

/**
 * The JSON the model is asked to produce. `uncertain` is the model's own
 * signal; `confidence` on ExtractionResult is derived from it plus whether
 * the required item fields came back.
 */
export interface ModelExtractionPayload {
  productName: string | null;
  brand: string | null;
  price: number | null;
  currency: string | null;
  category: ItemCategory | null;
  detectedSaleLanguage: boolean;
  saleLanguagePhrases: string[];
  uncertain: boolean;
}

export const EXTRACTION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'productName',
    'brand',
    'price',
    'currency',
    'category',
    'detectedSaleLanguage',
    'saleLanguagePhrases',
    'uncertain',
  ],
  properties: {
    productName: { type: ['string', 'null'] },
    brand: { type: ['string', 'null'] },
    price: { type: ['number', 'null'] },
    currency: { type: ['string', 'null'] },
    category: {
      anyOf: [{ type: 'string', enum: [...ITEM_CATEGORIES] }, { type: 'null' }],
    },
    detectedSaleLanguage: { type: 'boolean' },
    saleLanguagePhrases: { type: 'array', items: { type: 'string' } },
    uncertain: { type: 'boolean' },
  },
} as const;

const CATEGORY_SET = new Set<string>(ITEM_CATEGORIES);

export function parseModelExtractionPayload(raw: unknown): ModelExtractionPayload | null {
  if (!isRecord(raw)) {
    return null;
  }

  const productName = parseNullableString(raw.productName);
  const brand = parseNullableString(raw.brand);
  const price = parseNullablePrice(raw.price);
  const currency = parseNullableCurrency(raw.currency);
  const category = parseNullableCategory(raw.category);
  const detectedSaleLanguage = parseBoolean(raw.detectedSaleLanguage);
  const saleLanguagePhrases = parseStringArray(raw.saleLanguagePhrases);
  const uncertain = parseBoolean(raw.uncertain);

  if (detectedSaleLanguage === null || saleLanguagePhrases === null || uncertain === null) {
    return null;
  }

  // Presence of the keys is the shape check; null values are legitimate.
  if (!('productName' in raw) || !('brand' in raw) || !('price' in raw) || !('currency' in raw)) {
    return null;
  }

  return {
    productName,
    brand,
    price,
    currency,
    category,
    detectedSaleLanguage,
    saleLanguagePhrases,
    uncertain,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseNullableString(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function parseNullablePrice(value: unknown): number | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value;
}

function parseNullableCurrency(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(trimmed) ? trimmed : null;
}

function parseNullableCategory(value: unknown): ItemCategory | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string' || !CATEGORY_SET.has(value)) {
    return null;
  }
  return value as ItemCategory;
}

function parseBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function parseStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  if (!value.every((entry) => typeof entry === 'string')) {
    return null;
  }
  return value.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
}
