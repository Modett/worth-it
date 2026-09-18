import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { IsOptionalNotNull } from '../../../common/decorators/is-optional-not-null.decorator';
import { Trim } from '../../../common/decorators/trim.decorator';
import { ItemCategory, ITEM_CATEGORIES } from '../item-category';
import { ITEMS_CONFIG } from '../items.config';

/**
 * The descriptive fields a user may correct after the fact. `source`,
 * `sourceUrl` and `discoveredAt` record how and when the item was captured, so
 * they are fixed once written; `status` has its own endpoint and its own state
 * machine.
 */
export class UpdateItemDto {
  @ApiPropertyOptional({
    example: 'Runner 2 Trail Shoes',
    minLength: ITEMS_CONFIG.productName.minLength,
    maxLength: ITEMS_CONFIG.productName.maxLength,
  })
  @Trim()
  @IsOptionalNotNull()
  @IsString()
  @MinLength(ITEMS_CONFIG.productName.minLength)
  @MaxLength(ITEMS_CONFIG.productName.maxLength)
  productName?: string;

  @ApiPropertyOptional({
    example: 'Nike',
    maxLength: ITEMS_CONFIG.brand.maxLength,
    nullable: true,
    description: 'Send null to clear a brand that was recorded by mistake.',
  })
  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(ITEMS_CONFIG.brand.maxLength)
  brand?: string | null;

  @ApiPropertyOptional({ enum: ITEM_CATEGORIES, example: ItemCategory.FASHION })
  @IsOptionalNotNull()
  @IsEnum(ItemCategory)
  category?: ItemCategory;

  @ApiPropertyOptional({
    example: 119.99,
    minimum: ITEMS_CONFIG.price.min,
    maximum: ITEMS_CONFIG.price.max,
  })
  @IsOptionalNotNull()
  @IsNumber({ maxDecimalPlaces: ITEMS_CONFIG.price.decimalPlaces })
  @Min(ITEMS_CONFIG.price.min)
  @Max(ITEMS_CONFIG.price.max)
  price?: number;
}
