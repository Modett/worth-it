import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose, plainToInstance } from 'class-transformer';
import { ItemSource, ItemStatus, Prisma } from '../../../generated/prisma/client';
import { ItemCategory, ITEM_CATEGORIES } from '../item-category';

/** The Prisma row an item response is built from. */
export interface ItemRow {
  id: string;
  source: ItemSource;
  sourceUrl: string | null;
  imageUrl: string | null;
  productName: string;
  brand: string | null;
  category: string;
  price: Prisma.Decimal;
  detectedSaleLanguage: boolean;
  discoveredAt: Date;
  status: ItemStatus;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * The only shape an item is ever serialised in. `@Exclude()` on the class means
 * a column added to the Item model later cannot leak by being forgotten here —
 * the same guarantee UserResponseDto gives (.cursorrules §5). `userId` is
 * deliberately absent: every item a caller can reach is already their own.
 */
@Exclude()
export class ItemResponseDto {
  @Expose()
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @Expose()
  @ApiProperty({ enum: ItemSource, enumName: 'ItemSource' })
  source!: ItemSource;

  @Expose()
  @ApiPropertyOptional({ nullable: true, example: 'https://shop.example.com/products/runner-2' })
  sourceUrl!: string | null;

  @Expose()
  @ApiPropertyOptional({
    nullable: true,
    description: 'Stored screenshot, populated by the AI extraction module (step 6).',
  })
  imageUrl!: string | null;

  @Expose()
  @ApiProperty({ example: 'Runner 2 Trail Shoes' })
  productName!: string;

  @Expose()
  @ApiPropertyOptional({ nullable: true, example: 'Nike' })
  brand!: string | null;

  @Expose()
  @ApiProperty({ enum: ITEM_CATEGORIES })
  category!: ItemCategory;

  @Expose()
  @ApiProperty({ example: 129.99 })
  price!: number;

  @Expose()
  @ApiProperty({
    example: false,
    description: 'Whether the source used urgency phrasing. Set by step 6; a scoring input.',
  })
  detectedSaleLanguage!: boolean;

  @Expose()
  @ApiProperty({ format: 'date-time' })
  discoveredAt!: string;

  @Expose()
  @ApiProperty({ enum: ItemStatus, enumName: 'ItemStatus' })
  status!: ItemStatus;

  @Expose()
  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @Expose()
  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;

  static fromItem(item: ItemRow): ItemResponseDto {
    // Decimal and Date are converted before class-transformer sees them: it
    // clones an unrecognised class instance by calling its constructor, which
    // Decimal rejects. Money travels as a number (exact at Decimal(12, 2)) and
    // timestamps as ISO 8601 strings, since JSON has neither type.
    const wireValues = {
      ...item,
      price: Number(item.price),
      discoveredAt: item.discoveredAt.toISOString(),
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    };

    return plainToInstance(ItemResponseDto, wireValues, { excludeExtraneousValues: true });
  }
}
