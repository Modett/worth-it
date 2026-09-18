import { Injectable, Logger } from '@nestjs/common';
import { ItemSource, ItemStatus, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateItemDto } from './dto/create-item.dto';
import { ItemPageDto } from './dto/item-page.dto';
import { ItemResponseDto } from './dto/item-response.dto';
import { ItemSortField, ListItemsQueryDto, SortOrder } from './dto/list-items-query.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { UpdateItemStatusDto } from './dto/update-item-status.dto';
import {
  InvalidStatusTransitionException,
  ItemNotDeletableException,
  ItemNotEditableException,
  ItemNotFoundException,
} from './exceptions/items.exceptions';
import { allowsDeletion, allowsFieldEdits, canTransitionTo, ITEMS_CONFIG } from './items.config';

/**
 * The columns an item response is built from. `userId` is absent because it is
 * always the caller, and the relations (score, pause, rating) belong to the
 * modules that own them.
 */
const ITEM_SELECT = {
  id: true,
  source: true,
  sourceUrl: true,
  imageUrl: true,
  productName: true,
  brand: true,
  category: true,
  price: true,
  detectedSaleLanguage: true,
  discoveredAt: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** A Prisma client or an interactive-transaction client — both work here. */
type ItemReader = Pick<PrismaService, 'item'>;

@Injectable()
export class ItemsService {
  private readonly logger = new Logger(ItemsService.name);

  constructor(private readonly prismaService: PrismaService) {}

  async create(userId: string, dto: CreateItemDto): Promise<ItemResponseDto> {
    const item = await this.prismaService.item.create({
      data: {
        userId,
        source: dto.source,
        // Belt and braces with the DTO's conditional rule: whatever a caller
        // sends, a non-LINK item is never given a product URL to point at.
        sourceUrl: dto.source === ItemSource.LINK ? (dto.sourceUrl ?? null) : null,
        imageUrl: dto.source === ItemSource.SCREENSHOT ? (dto.imageUrl ?? null) : null,
        productName: dto.productName,
        brand: dto.brand ?? null,
        category: dto.category,
        price: dto.price,
        detectedSaleLanguage: dto.detectedSaleLanguage ?? false,
        discoveredAt: dto.discoveredAt ?? new Date(),
        // Written rather than left to the column default, so the one state a
        // new item can start in is visible at the point it is decided.
        status: ItemStatus.WISHLIST,
      },
      select: ITEM_SELECT,
    });

    // Identifiers only — never the product name or price (.cursorrules §5).
    this.logger.log({ userId, itemId: item.id, source: item.source }, 'Item created');

    return ItemResponseDto.fromItem(item);
  }

  async list(userId: string, query: ListItemsQueryDto): Promise<ItemPageDto> {
    const limit = query.limit ?? ITEMS_CONFIG.pagination.defaultPageSize;
    const order = query.order ?? SortOrder.DESC;

    const rows = await this.prismaService.item.findMany({
      // userId is part of the filter, not a check applied to the results, so
      // another user's item is never in the set to be leaked in the first place.
      where: { userId, status: query.status, category: query.category },
      orderBy: buildOrderBy(query.sortBy ?? ItemSortField.DISCOVERED_AT, order),
      // One row beyond the page answers "is there more?" without a second query.
      take: limit + 1,
      // The cursor row itself belongs to the previous page, hence the skip.
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: ITEM_SELECT,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    return {
      data: page.map((row) => ItemResponseDto.fromItem(row)),
      nextCursor: hasMore ? page[page.length - 1].id : null,
      hasMore,
    };
  }

  async findOne(userId: string, itemId: string): Promise<ItemResponseDto> {
    const item = await this.prismaService.item.findFirst({
      where: { id: itemId, userId },
      select: ITEM_SELECT,
    });

    if (!item) {
      throw new ItemNotFoundException();
    }

    return ItemResponseDto.fromItem(item);
  }

  async update(userId: string, itemId: string, dto: UpdateItemDto): Promise<ItemResponseDto> {
    return this.prismaService.$transaction(async (tx) => {
      const { status } = await this.requireOwnedItem(tx, userId, itemId);

      if (!allowsFieldEdits(status)) {
        throw new ItemNotEditableException(status);
      }

      const item = await tx.item.update({
        where: { id: itemId },
        // Prisma skips `undefined`, so an omitted field keeps its stored value
        // while an explicit `null` brand clears it.
        data: {
          productName: dto.productName,
          brand: dto.brand,
          category: dto.category,
          price: dto.price,
        },
        select: ITEM_SELECT,
      });

      return ItemResponseDto.fromItem(item);
    });
  }

  async updateStatus(
    userId: string,
    itemId: string,
    dto: UpdateItemStatusDto,
  ): Promise<ItemResponseDto> {
    return this.prismaService.$transaction(async (tx) => {
      const { status } = await this.requireOwnedItem(tx, userId, itemId);

      if (!canTransitionTo(status, dto.status)) {
        throw new InvalidStatusTransitionException(status, dto.status);
      }

      const item = await tx.item.update({
        where: { id: itemId },
        data: { status: dto.status },
        select: ITEM_SELECT,
      });

      this.logger.log(
        { userId, itemId, from: status, to: item.status },
        'Item status transitioned',
      );

      return ItemResponseDto.fromItem(item);
    });
  }

  async remove(userId: string, itemId: string): Promise<void> {
    await this.prismaService.$transaction(async (tx) => {
      const { status } = await this.requireOwnedItem(tx, userId, itemId);

      if (!allowsDeletion(status)) {
        throw new ItemNotDeletableException(status);
      }

      await tx.item.delete({ where: { id: itemId } });
    });

    this.logger.log({ userId, itemId }, 'Item deleted at user request');
  }

  /**
   * The single ownership gate for every by-id operation. An item belonging to
   * someone else is reported exactly as a non-existent one, so a caller cannot
   * use the difference to discover which ids are real.
   */
  private async requireOwnedItem(
    client: ItemReader,
    userId: string,
    itemId: string,
  ): Promise<{ status: ItemStatus }> {
    const item = await client.item.findFirst({
      where: { id: itemId, userId },
      select: { status: true },
    });

    if (!item) {
      throw new ItemNotFoundException();
    }

    return item;
  }
}

/**
 * `id` breaks ties so the ordering is total. Without it two items sharing a
 * discoveredAt (or a price) could straddle a page boundary and be repeated or
 * skipped, and the cursor into that ordering would be ambiguous.
 */
function buildOrderBy(
  sortBy: ItemSortField,
  order: SortOrder,
): Prisma.ItemOrderByWithRelationInput[] {
  return sortBy === ItemSortField.PRICE
    ? [{ price: order }, { id: order }]
    : [{ discoveredAt: order }, { id: order }];
}
