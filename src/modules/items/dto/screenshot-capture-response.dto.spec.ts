import { ItemCategory } from '../item-category';
import { ExtractionResult } from '../../ai/interfaces/ai-extraction.interface';
import { ScreenshotExtractionDto } from './screenshot-capture-response.dto';

describe('ScreenshotExtractionDto', () => {
  it('drops rawModelResponse even when the full extraction is passed in', () => {
    const extraction: ExtractionResult = {
      productName: 'Runner 2',
      brand: 'Nike',
      price: 129.99,
      currency: 'USD',
      category: ItemCategory.FASHION,
      detectedSaleLanguage: true,
      saleLanguagePhrases: ['70% OFF'],
      confidence: 'high',
      rawModelResponse: { content: 'secret-tuning-payload' },
    };

    const dto = ScreenshotExtractionDto.fromExtraction(extraction);

    expect(dto).toMatchObject({
      productName: 'Runner 2',
      confidence: 'high',
      saleLanguagePhrases: ['70% OFF'],
    });
    expect(dto).not.toHaveProperty('rawModelResponse');
    expect(JSON.stringify(dto)).not.toContain('secret-tuning-payload');
  });
});
