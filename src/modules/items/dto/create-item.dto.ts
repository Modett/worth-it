import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxDate,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { IsOptionalNotNull } from '../../../common/decorators/is-optional-not-null.decorator';
import { Trim } from '../../../common/decorators/trim.decorator';
import { ItemCategory, ITEM_CATEGORIES } from '../item-category';
import { CreatableItemSource, ITEMS_CONFIG } from '../items.config';
import { ImageUrlMatchesSource } from './image-url-matches-source.decorator';
import { SourceUrlMatchesSource } from './source-url-matches-source.decorator';

/**
 * The item as the client describes it. Everything derived — the owner, the
 * WISHLIST starting status, the regret score — is the server's to set, so none
 * of it appears here. SCREENSHOT items are usually born on
 * POST /items/from-screenshot; this DTO is the confirm/edit path when
 * extraction was low-confidence.
 */
export class CreateItemDto {
  @ApiProperty({
    enum: [...ITEMS_CONFIG.creatableSources],
    example: ITEMS_CONFIG.creatableSources[0],
    description:
      'Where the item came from. SCREENSHOT requires imageUrl (the R2 URL returned by /items/from-screenshot).',
  })
  @IsIn([...ITEMS_CONFIG.creatableSources])
  source!: CreatableItemSource;

  @ApiPropertyOptional({
    example: 'https://shop.example.com/products/runner-2',
    maxLength: ITEMS_CONFIG.sourceUrl.maxLength,
    description: 'Required when source is LINK, and rejected for any other source.',
  })
  @SourceUrlMatchesSource()
  sourceUrl?: string;

  @ApiPropertyOptional({
    example: 'https://cdn.example.com/users/…/screenshots/….jpg',
    maxLength: ITEMS_CONFIG.imageUrl.maxLength,
    description: 'Required when source is SCREENSHOT, and rejected for any other source.',
  })
  @ImageUrlMatchesSource()
  imageUrl?: string;

  @ApiProperty({
    example: 'Runner 2 Trail Shoes',
    minLength: ITEMS_CONFIG.productName.minLength,
    maxLength: ITEMS_CONFIG.productName.maxLength,
  })
  @Trim()
  @IsString()
  @MinLength(ITEMS_CONFIG.productName.minLength)
  @MaxLength(ITEMS_CONFIG.productName.maxLength)
  productName!: string;

  @ApiPropertyOptional({
    example: 'Nike',
    maxLength: ITEMS_CONFIG.brand.maxLength,
    nullable: true,
  })
  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(ITEMS_CONFIG.brand.maxLength)
  brand?: string | null;

  @ApiProperty({ enum: ITEM_CATEGORIES, example: ItemCategory.FASHION })
  @IsEnum(ItemCategory)
  category!: ItemCategory;

  @ApiProperty({
    example: 129.99,
    minimum: ITEMS_CONFIG.price.min,
    maximum: ITEMS_CONFIG.price.max,
  })
  @IsNumber({ maxDecimalPlaces: ITEMS_CONFIG.price.decimalPlaces })
  @Min(ITEMS_CONFIG.price.min)
  @Max(ITEMS_CONFIG.price.max)
  price!: number;

  @ApiPropertyOptional({
    example: false,
    description:
      'Whether the source used urgency phrasing. Set automatically on high-confidence screenshot capture; the confirm path may pass through the extraction value.',
  })
  @IsOptional()
  @IsBoolean()
  detectedSaleLanguage?: boolean;

  @ApiPropertyOptional({
    format: 'date-time',
    description:
      'When the user found the item. Defaults to now, and cannot be in the future — the ' +
      'scoring engine reads it as "how long ago was this wanted".',
  })
  @IsOptionalNotNull()
  @Type(() => Date)
  @IsDate()
  @MaxDate(() => new Date(), { message: 'discoveredAt cannot be in the future' })
  discoveredAt?: Date;
}
