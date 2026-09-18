import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { ItemSource, ItemStatus } from '../../generated/prisma/client';
import { ItemPageDto } from './dto/item-page.dto';
import { ItemResponseDto } from './dto/item-response.dto';
import { ItemCategory } from './item-category';
import { ItemsController } from './items.controller';
import { ItemsService } from './items.service';
import { ScreenshotService } from './screenshot.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ITEM_ID = '33333333-3333-4333-8333-333333333333';

const item: ItemResponseDto = {
  id: ITEM_ID,
  source: ItemSource.LINK,
  sourceUrl: 'https://shop.example.com/products/runner-2',
  imageUrl: null,
  productName: 'Runner 2 Trail Shoes',
  brand: 'Nike',
  category: ItemCategory.FASHION,
  price: 129.99,
  detectedSaleLanguage: false,
  discoveredAt: '2026-09-01T08:30:00.000Z',
  status: ItemStatus.WISHLIST,
  createdAt: '2026-09-13T10:00:00.000Z',
  updatedAt: '2026-09-13T10:00:00.000Z',
};

const page: ItemPageDto = { data: [item], nextCursor: null, hasMore: false };

describe('ItemsController', () => {
  let controller: ItemsController;
  let itemsService: {
    create: jest.Mock;
    list: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
    updateStatus: jest.Mock;
    remove: jest.Mock;
  };
  let screenshotService: { capture: jest.Mock };

  beforeEach(async () => {
    itemsService = {
      create: jest.fn(),
      list: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      updateStatus: jest.fn(),
      remove: jest.fn(),
    };
    screenshotService = { capture: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      controllers: [ItemsController],
      providers: [
        { provide: ItemsService, useValue: itemsService },
        { provide: ScreenshotService, useValue: screenshotService },
      ],
    }).compile();

    controller = moduleRef.get(ItemsController);
  });

  const reflector = new Reflector();

  it('creates against the id from the access token, not one from the body', async () => {
    itemsService.create.mockResolvedValue(item);
    const dto = {
      source: ItemSource.LINK,
      sourceUrl: 'https://shop.example.com/products/runner-2',
      productName: 'Runner 2 Trail Shoes',
      category: ItemCategory.FASHION,
      price: 129.99,
    };

    await expect(controller.create(USER_ID, dto)).resolves.toBe(item);
    expect(itemsService.create).toHaveBeenCalledWith(USER_ID, dto);
  });

  it('passes the list filters straight through without interpreting them', async () => {
    itemsService.list.mockResolvedValue(page);
    const query = { status: ItemStatus.WISHLIST, limit: 10 };

    await expect(controller.list(USER_ID, query)).resolves.toBe(page);
    expect(itemsService.list).toHaveBeenCalledWith(USER_ID, query);
  });

  it('scopes a single-item read to the caller', async () => {
    itemsService.findOne.mockResolvedValue(item);

    await expect(controller.findOne(USER_ID, ITEM_ID)).resolves.toBe(item);
    expect(itemsService.findOne).toHaveBeenCalledWith(USER_ID, ITEM_ID);
  });

  it('delegates a field update', async () => {
    itemsService.update.mockResolvedValue(item);
    const dto = { price: 99.5 };

    await expect(controller.update(USER_ID, ITEM_ID, dto)).resolves.toBe(item);
    expect(itemsService.update).toHaveBeenCalledWith(USER_ID, ITEM_ID, dto);
  });

  it('delegates a status transition, leaving the state machine to the service', async () => {
    itemsService.updateStatus.mockResolvedValue(item);
    const dto = { status: ItemStatus.PURCHASED } as const;

    await expect(controller.updateStatus(USER_ID, ITEM_ID, dto)).resolves.toBe(item);
    expect(itemsService.updateStatus).toHaveBeenCalledWith(USER_ID, ITEM_ID, dto);
  });

  it('delegates screenshot capture and sets 201 when the item was auto-created', async () => {
    const file = { buffer: Buffer.from('png'), mimetype: 'image/png' } as Express.Multer.File;
    const created = {
      autoCreated: true,
      imageUrl: 'https://cdn.example.test/shot.jpg',
      item,
      extraction: {},
    };
    screenshotService.capture.mockResolvedValue(created);
    const response = { status: jest.fn() };

    await expect(
      controller.createFromScreenshot(
        USER_ID,
        file,
        response as unknown as import('express').Response,
      ),
    ).resolves.toBe(created);
    expect(screenshotService.capture).toHaveBeenCalledWith(USER_ID, file);
    expect(response.status).toHaveBeenCalledWith(201);
  });

  it('sets 200 when extraction is a draft rather than an item', async () => {
    const file = { buffer: Buffer.from('png'), mimetype: 'image/png' } as Express.Multer.File;
    const preview = {
      autoCreated: false,
      imageUrl: 'https://cdn.example.test/shot.jpg',
      item: null,
      extraction: { confidence: 'low' },
    };
    screenshotService.capture.mockResolvedValue(preview);
    const response = { status: jest.fn() };

    await expect(
      controller.createFromScreenshot(
        USER_ID,
        file,
        response as unknown as import('express').Response,
      ),
    ).resolves.toBe(preview);
    expect(response.status).toHaveBeenCalledWith(200);
  });

  describe('route protection', () => {
    it.each([
      'create',
      'createFromScreenshot',
      'list',
      'findOne',
      'update',
      'updateStatus',
      'remove',
    ] as const)('%s is not @Public(), so the global JWT guard protects it', (route) => {
      expect(
        reflector.get<boolean | undefined>(IS_PUBLIC_KEY, ItemsController.prototype[route]),
      ).toBeUndefined();
    });
  });
});
