import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { ItemStatus } from '../../../generated/prisma/client';
import { ItemCategory, ITEM_CATEGORIES } from '../item-category';
import { ITEMS_CONFIG } from '../items.config';

/** The item fields a list may be ordered by. */
export const ItemSortField = {
  DISCOVERED_AT: 'discoveredAt',
  PRICE: 'price',
} as const;

export type ItemSortField = (typeof ItemSortField)[keyof typeof ItemSortField];

export const SortOrder = {
  ASC: 'asc',
  DESC: 'desc',
} as const;

export type SortOrder = (typeof SortOrder)[keyof typeof SortOrder];

export const ITEM_SORT_FIELDS = Object.values(ItemSortField);
export const SORT_ORDERS = Object.values(SortOrder);

export class ListItemsQueryDto {
  @ApiPropertyOptional({ enum: ItemStatus, description: 'Return only items in this state' })
  @IsOptional()
  @IsEnum(ItemStatus)
  status?: ItemStatus;

  @ApiPropertyOptional({ enum: ITEM_CATEGORIES })
  @IsOptional()
  @IsEnum(ItemCategory)
  category?: ItemCategory;

  @ApiPropertyOptional({
    enum: ITEM_SORT_FIELDS,
    default: ItemSortField.DISCOVERED_AT,
  })
  @IsOptional()
  @IsIn(ITEM_SORT_FIELDS)
  sortBy?: ItemSortField;

  @ApiPropertyOptional({ enum: SORT_ORDERS, default: SortOrder.DESC })
  @IsOptional()
  @IsIn(SORT_ORDERS)
  order?: SortOrder;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: ITEMS_CONFIG.pagination.maxPageSize,
    default: ITEMS_CONFIG.pagination.defaultPageSize,
  })
  @IsOptional()
  // Query strings are always text, and the app-wide pipe deliberately does not
  // convert implicitly, so the cast is asked for here rather than everywhere.
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(ITEMS_CONFIG.pagination.maxPageSize)
  limit?: number;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      "Opaque marker from the previous page's `nextCursor`. Treat it as a token: it happens " +
      'to be an item id today.',
  })
  @IsOptional()
  @IsUUID()
  cursor?: string;
}
