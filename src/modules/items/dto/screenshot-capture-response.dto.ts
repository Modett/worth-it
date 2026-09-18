import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose, plainToInstance, Type } from 'class-transformer';
import { ItemCategory, ITEM_CATEGORIES } from '../item-category';
import { ExtractionResult } from '../../ai/interfaces/ai-extraction.interface';
import { ItemResponseDto } from './item-response.dto';

export const EXTRACTION_CONFIDENCE = ['high', 'low'] as const;
export type ExtractionConfidence = (typeof EXTRACTION_CONFIDENCE)[number];

/**
 * The extraction the client may show and edit. `rawModelResponse` is
 * deliberately absent — @Exclude() on the class means it cannot leak even if
 * a caller spreads the full ExtractionResult into this DTO.
 */
@Exclude()
export class ScreenshotExtractionDto {
  @Expose()
  @ApiPropertyOptional({ nullable: true, type: String, example: 'Runner 2 Trail Shoes' })
  productName!: string | null;

  @Expose()
  @ApiPropertyOptional({ nullable: true, type: String, example: 'Nike' })
  brand!: string | null;

  @Expose()
  @ApiPropertyOptional({ nullable: true, type: Number, example: 129.99 })
  price!: number | null;

  @Expose()
  @ApiPropertyOptional({ nullable: true, type: String, example: 'USD' })
  currency!: string | null;

  @Expose()
  @ApiPropertyOptional({ nullable: true, enum: ITEM_CATEGORIES })
  category!: ItemCategory | null;

  @Expose()
  @ApiProperty()
  detectedSaleLanguage!: boolean;

  @Expose()
  @ApiProperty({ type: [String], example: ['LIMITED TIME'] })
  saleLanguagePhrases!: string[];

  @Expose()
  @ApiProperty({ enum: EXTRACTION_CONFIDENCE })
  confidence!: ExtractionConfidence;

  static fromExtraction(result: ExtractionResult): ScreenshotExtractionDto {
    return plainToInstance(ScreenshotExtractionDto, result, { excludeExtraneousValues: true });
  }
}

@Exclude()
export class ScreenshotCaptureResponseDto {
  @Expose()
  @ApiProperty({
    description: 'True when required fields were confident enough to create the Item immediately.',
  })
  autoCreated!: boolean;

  @Expose()
  @ApiProperty({ description: 'Public URL of the original screenshot stored in R2.' })
  imageUrl!: string;

  @Expose()
  @ApiPropertyOptional({
    type: ItemResponseDto,
    nullable: true,
    description:
      'Set when autoCreated is true; otherwise the client should confirm via POST /items.',
  })
  @Type(() => ItemResponseDto)
  item!: ItemResponseDto | null;

  @Expose()
  @ApiProperty({ type: ScreenshotExtractionDto })
  @Type(() => ScreenshotExtractionDto)
  extraction!: ScreenshotExtractionDto;

  static created(
    imageUrl: string,
    extraction: ScreenshotExtractionDto,
    item: ItemResponseDto,
  ): ScreenshotCaptureResponseDto {
    return plainToInstance(
      ScreenshotCaptureResponseDto,
      { autoCreated: true, imageUrl, item, extraction },
      { excludeExtraneousValues: true },
    );
  }

  static preview(
    imageUrl: string,
    extraction: ScreenshotExtractionDto,
  ): ScreenshotCaptureResponseDto {
    return plainToInstance(
      ScreenshotCaptureResponseDto,
      { autoCreated: false, imageUrl, item: null, extraction },
      { excludeExtraneousValues: true },
    );
  }
}
