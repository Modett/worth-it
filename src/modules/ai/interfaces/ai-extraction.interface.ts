import { ItemCategory } from '../../items/item-category';

export type ExtractionConfidence = 'high' | 'low';

export interface AiExtractionService {
  extractFromImage(input: { imageBuffer: Buffer; mimeType: string }): Promise<ExtractionResult>;
}

export interface ExtractionResult {
  productName: string | null;
  brand: string | null;
  price: number | null;
  currency: string | null;
  /** Best-effort guess at the Items-module vocabulary; null if genuinely unclear. */
  category: ItemCategory | null;
  detectedSaleLanguage: boolean;
  /** e.g. `["LIMITED TIME", "70% OFF"]`. */
  saleLanguagePhrases: string[];
  /**
   * `low` if the model signals uncertainty or a required field is missing —
   * downstream uses this to ask the user to confirm before creating the Item.
   */
  confidence: ExtractionConfidence;
  /** Stored for debugging/tuning, never returned to the client. */
  rawModelResponse: unknown;
}
