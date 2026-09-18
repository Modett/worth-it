import { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp, NEST_FACTORY_OPTIONS } from '../src/app.setup';
import { ErrorResponse } from '../src/common/filters/error-response.interface';
import { AuthTokensDto } from '../src/modules/auth/dto/auth-tokens.dto';
import { ItemPageDto } from '../src/modules/items/dto/item-page.dto';
import { ItemResponseDto } from '../src/modules/items/dto/item-response.dto';
import { ITEMS_CONFIG } from '../src/modules/items/items.config';
import { PrismaService } from '../src/prisma/prisma.service';

const PASSWORD = 'correct-horse-battery';

const LINK_ITEM = {
  source: 'LINK',
  sourceUrl: 'https://shop.example.com/products/runner-2',
  productName: 'Runner 2 Trail Shoes',
  brand: 'Nike',
  category: 'FASHION',
  price: 129.99,
};

const MANUAL_ITEM = {
  source: 'MANUAL',
  productName: 'Standing desk',
  category: 'HOME',
  price: 450,
};

describe('Items (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prismaService: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(
      moduleRef.createNestApplication<NestExpressApplication>(NEST_FACTORY_OPTIONS),
    );
    await app.init();
    server = app.getHttpServer() as Server;
    prismaService = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  function uniqueEmail(): string {
    return `shopper-${randomUUID()}@example.com`;
  }

  /**
   * Rate limiting is per IP and its counters live in Redis, so they outlive a
   * single test file. Every request presents its own client address rather than
   * sharing one budget across the suite.
   */
  function uniqueClientIp(): string {
    const octet = (): number => 1 + Math.floor(Math.random() * 254);
    return `10.${octet()}.${octet()}.${octet()}`;
  }

  async function registerUser(): Promise<AuthTokensDto> {
    const email = uniqueEmail();

    await request(server)
      .post('/api/v1/auth/signup')
      .set('X-Forwarded-For', uniqueClientIp())
      .send({ email, password: PASSWORD })
      .expect(201);

    const response = await request(server)
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', uniqueClientIp())
      .send({ email, password: PASSWORD })
      .expect(200);

    return response.body as AuthTokensDto;
  }

  function authenticated(
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    accessToken: string,
  ): request.Test {
    return request(server)
      [method](path)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Forwarded-For', uniqueClientIp());
  }

  function postItem(accessToken: string, body: Record<string, unknown> = LINK_ITEM): request.Test {
    return authenticated('post', '/api/v1/items', accessToken).send(body);
  }

  function listItems(accessToken: string, query = ''): request.Test {
    return authenticated('get', `/api/v1/items${query}`, accessToken);
  }

  function getItem(accessToken: string, itemId: string): request.Test {
    return authenticated('get', `/api/v1/items/${itemId}`, accessToken);
  }

  function patchItem(
    accessToken: string,
    itemId: string,
    body: Record<string, unknown>,
  ): request.Test {
    return authenticated('patch', `/api/v1/items/${itemId}`, accessToken).send(body);
  }

  function patchStatus(accessToken: string, itemId: string, status: string): request.Test {
    return authenticated('patch', `/api/v1/items/${itemId}/status`, accessToken).send({ status });
  }

  function deleteItem(accessToken: string, itemId: string): request.Test {
    return authenticated('delete', `/api/v1/items/${itemId}`, accessToken);
  }

  async function createItem(
    accessToken: string,
    body: Record<string, unknown> = LINK_ITEM,
  ): Promise<ItemResponseDto> {
    const response = await postItem(accessToken, body).expect(201);
    return response.body as ItemResponseDto;
  }

  describe('the item lifecycle, end to end', () => {
    it('carries an item from capture through a purchase and a return', async () => {
      const tokens = await registerUser();

      // 1. A new item always starts on the wishlist.
      const created = await createItem(tokens.accessToken);
      expect(created).toMatchObject({
        source: 'LINK',
        sourceUrl: LINK_ITEM.sourceUrl,
        productName: LINK_ITEM.productName,
        brand: 'Nike',
        category: 'FASHION',
        price: 129.99,
        status: 'WISHLIST',
        imageUrl: null,
        detectedSaleLanguage: false,
      });

      // 2. It shows up in the owner's list and can be read back on its own.
      const page = (await listItems(tokens.accessToken).expect(200)).body as ItemPageDto;
      expect(page.data.map((item) => item.id)).toEqual([created.id]);
      expect((await getItem(tokens.accessToken, created.id).expect(200)).body).toEqual(created);

      // 3. Details can be corrected while the decision is still open.
      const corrected = (
        await patchItem(tokens.accessToken, created.id, {
          productName: 'Runner 3 Trail Shoes',
          price: 149.5,
        }).expect(200)
      ).body as ItemResponseDto;
      expect(corrected).toMatchObject({
        productName: 'Runner 3 Trail Shoes',
        price: 149.5,
        brand: 'Nike',
        status: 'WISHLIST',
      });

      // 4. Buying it closes the decision.
      const purchased = (await patchStatus(tokens.accessToken, created.id, 'PURCHASED').expect(200))
        .body as ItemResponseDto;
      expect(purchased.status).toBe('PURCHASED');

      // 5. From here the details are history, so editing them is refused.
      const rejectedEdit = await patchItem(tokens.accessToken, created.id, {
        price: 10,
      }).expect(400);
      expect((rejectedEdit.body as ErrorResponse).message).toContain('PURCHASED');
      await expect(storedPrice(created.id)).resolves.toBe('149.50');

      // 6. A purchase can still be returned.
      const returned = (await patchStatus(tokens.accessToken, created.id, 'RETURNED').expect(200))
        .body as ItemResponseDto;
      expect(returned.status).toBe('RETURNED');

      // 7. RETURNED is final: nothing leads out of it.
      for (const status of ['PURCHASED', 'SKIPPED', 'RETURNED']) {
        const response = await patchStatus(tokens.accessToken, created.id, status).expect(400);
        expect((response.body as ErrorResponse).message).toContain('RETURNED');
      }

      // 8. And it is kept rather than deletable, because it is regret data now.
      await deleteItem(tokens.accessToken, created.id).expect(400);
      await expect(prismaService.item.count({ where: { id: created.id } })).resolves.toBe(1);
    });
  });

  describe('POST /items', () => {
    it('stores a SCREENSHOT item against the supplied image URL', async () => {
      const tokens = await registerUser();
      const imageUrl = 'https://cdn.example.test/users/me/screenshots/shot.jpg';

      const created = await createItem(tokens.accessToken, {
        source: 'SCREENSHOT',
        imageUrl,
        productName: 'Runner 2 Trail Shoes',
        category: 'FASHION',
        price: 129.99,
        detectedSaleLanguage: true,
      });

      expect(created).toMatchObject({
        source: 'SCREENSHOT',
        sourceUrl: null,
        imageUrl,
        detectedSaleLanguage: true,
        status: 'WISHLIST',
      });
    });

    it('defaults discoveredAt to the moment of capture', async () => {
      const tokens = await registerUser();
      const before = Date.now();

      const created = await createItem(tokens.accessToken);

      const discoveredAt = new Date(created.discoveredAt).getTime();
      expect(discoveredAt).toBeGreaterThanOrEqual(before - 1000);
      expect(discoveredAt).toBeLessThanOrEqual(Date.now() + 1000);
    });

    it('keeps a discoveredAt the client backdated', async () => {
      const tokens = await registerUser();
      const discoveredAt = '2026-09-01T08:30:00.000Z';

      const created = await createItem(tokens.accessToken, { ...LINK_ITEM, discoveredAt });

      expect(created.discoveredAt).toBe(discoveredAt);
    });

    it('stores the price with cents intact', async () => {
      const tokens = await registerUser();

      const created = await createItem(tokens.accessToken, { ...LINK_ITEM, price: 1234.56 });

      await expect(storedPrice(created.id)).resolves.toBe('1234.56');
    });

    it('records the item against the caller, whoever the body names', async () => {
      const mine = await registerUser();
      const other = await registerUser();
      const otherProfile = await profileId(other.accessToken);

      // userId is not a property of the DTO, so the app-wide pipe refuses the
      // request outright rather than silently ignoring the field.
      await postItem(mine.accessToken, { ...LINK_ITEM, userId: otherProfile }).expect(400);

      await expect(prismaService.item.count({ where: { userId: otherProfile } })).resolves.toBe(0);
    });

    it.each([
      ['a LINK item with no URL', { ...LINK_ITEM, sourceUrl: undefined }],
      ['a MANUAL item carrying a URL', { ...MANUAL_ITEM, sourceUrl: LINK_ITEM.sourceUrl }],
      ['a URL with no scheme', { ...LINK_ITEM, sourceUrl: 'shop.example.com/runner-2' }],
      [
        'a SCREENSHOT source with no image',
        { ...LINK_ITEM, source: 'SCREENSHOT', sourceUrl: undefined },
      ],
      [
        'a LINK item carrying an imageUrl',
        { ...LINK_ITEM, imageUrl: 'https://cdn.example.com/shot.jpg' },
      ],
      ['an unknown source', { ...LINK_ITEM, source: 'IMPORTED' }],
      ['a blank product name', { ...LINK_ITEM, productName: '   ' }],
      ['an over-long product name', { ...LINK_ITEM, productName: 'a'.repeat(201) }],
      ['an over-long brand', { ...LINK_ITEM, brand: 'a'.repeat(101) }],
      ['a category outside the vocabulary', { ...LINK_ITEM, category: 'GROCERIES' }],
      ['a zero price', { ...LINK_ITEM, price: 0 }],
      ['a negative price', { ...LINK_ITEM, price: -1 }],
      ['a price above the ceiling', { ...LINK_ITEM, price: ITEMS_CONFIG.price.max + 1 }],
      ['a sub-cent price', { ...LINK_ITEM, price: 10.123 }],
      ['a status the client picked', { ...LINK_ITEM, status: 'PURCHASED' }],
      ['a score the client picked', { ...LINK_ITEM, regretScore: 10 }],
    ])('rejects %s with a 400', async (_case, body) => {
      const tokens = await registerUser();

      const response = await postItem(tokens.accessToken, body).expect(400);

      expect((response.body as ErrorResponse).error).toBe('Bad Request');
    });

    it('rejects a discovery date in the future', async () => {
      const tokens = await registerUser();
      const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();

      const response = await postItem(tokens.accessToken, {
        ...LINK_ITEM,
        discoveredAt: future,
      }).expect(400);

      expect(JSON.stringify(response.body)).toContain('future');
    });
  });

  describe('GET /items', () => {
    it("returns only the caller's items, never a neighbour's", async () => {
      const mine = await registerUser();
      const theirs = await registerUser();
      const myItem = await createItem(mine.accessToken);
      const theirItem = await createItem(theirs.accessToken, MANUAL_ITEM);

      const page = (await listItems(mine.accessToken).expect(200)).body as ItemPageDto;

      expect(page.data.map((item) => item.id)).toEqual([myItem.id]);
      expect(JSON.stringify(page)).not.toContain(theirItem.id);
    });

    it('filters by status and by category', async () => {
      const tokens = await registerUser();
      const wishlisted = await createItem(tokens.accessToken);
      const bought = await createItem(tokens.accessToken, MANUAL_ITEM);
      await patchStatus(tokens.accessToken, bought.id, 'PURCHASED').expect(200);

      const byStatus = (await listItems(tokens.accessToken, '?status=PURCHASED').expect(200))
        .body as ItemPageDto;
      expect(byStatus.data.map((item) => item.id)).toEqual([bought.id]);

      const byCategory = (await listItems(tokens.accessToken, '?category=FASHION').expect(200))
        .body as ItemPageDto;
      expect(byCategory.data.map((item) => item.id)).toEqual([wishlisted.id]);
    });

    it('sorts by price in either direction', async () => {
      const tokens = await registerUser();
      const cheap = await createItem(tokens.accessToken, { ...LINK_ITEM, price: 10 });
      const dear = await createItem(tokens.accessToken, { ...LINK_ITEM, price: 990 });

      const ascending = (await listItems(tokens.accessToken, '?sortBy=price&order=asc').expect(200))
        .body as ItemPageDto;
      expect(ascending.data.map((item) => item.id)).toEqual([cheap.id, dear.id]);

      const descending = (
        await listItems(tokens.accessToken, '?sortBy=price&order=desc').expect(200)
      ).body as ItemPageDto;
      expect(descending.data.map((item) => item.id)).toEqual([dear.id, cheap.id]);
    });

    it('defaults to newest discovery first', async () => {
      const tokens = await registerUser();
      const older = await createItem(tokens.accessToken, {
        ...LINK_ITEM,
        discoveredAt: '2026-09-01T08:30:00.000Z',
      });
      const newer = await createItem(tokens.accessToken, {
        ...LINK_ITEM,
        discoveredAt: '2026-09-10T08:30:00.000Z',
      });

      const page = (await listItems(tokens.accessToken).expect(200)).body as ItemPageDto;

      expect(page.data.map((item) => item.id)).toEqual([newer.id, older.id]);
    });

    it('walks a collection larger than one page with the cursor', async () => {
      const tokens = await registerUser();
      const pageSize = ITEMS_CONFIG.pagination.defaultPageSize;
      const total = pageSize + 5;
      const discoveredBase = Date.parse('2026-09-10T08:30:00.000Z');

      // Distinct discovery times, newest first, so the expected order is fixed.
      const expectedIds: string[] = [];
      for (let index = 0; index < total; index += 1) {
        const created = await createItem(tokens.accessToken, {
          ...LINK_ITEM,
          discoveredAt: new Date(discoveredBase - index * 60_000).toISOString(),
        });
        expectedIds.push(created.id);
      }

      const first = (await listItems(tokens.accessToken).expect(200)).body as ItemPageDto;
      expect(first.data).toHaveLength(pageSize);
      expect(first.hasMore).toBe(true);
      expect(first.nextCursor).toBe(first.data[pageSize - 1].id);

      const second = (
        await listItems(tokens.accessToken, `?cursor=${first.nextCursor ?? ''}`).expect(200)
      ).body as ItemPageDto;
      expect(second.data).toHaveLength(total - pageSize);
      expect(second.hasMore).toBe(false);
      expect(second.nextCursor).toBeNull();

      // The two pages together are the whole collection, in order and with no
      // row repeated or skipped across the boundary.
      const seen = [...first.data, ...second.data].map((item) => item.id);
      expect(seen).toEqual(expectedIds);
      expect(new Set(seen).size).toBe(total);
    });

    it('honours a smaller page size and keeps paging until the end', async () => {
      const tokens = await registerUser();
      for (let index = 0; index < 5; index += 1) {
        await createItem(tokens.accessToken, {
          ...LINK_ITEM,
          discoveredAt: new Date(
            Date.parse('2026-09-10T08:30:00.000Z') - index * 60_000,
          ).toISOString(),
        });
      }

      const collected: string[] = [];
      let cursor: string | null = null;
      let pages = 0;

      do {
        const query = cursor === null ? '?limit=2' : `?limit=2&cursor=${cursor}`;
        const page = (await listItems(tokens.accessToken, query).expect(200)).body as ItemPageDto;
        collected.push(...page.data.map((item) => item.id));
        cursor = page.nextCursor;
        pages += 1;
      } while (cursor !== null && pages < 10);

      expect(pages).toBe(3);
      expect(collected).toHaveLength(5);
      expect(new Set(collected).size).toBe(5);
    });

    it('returns an empty page for a user with nothing saved', async () => {
      const tokens = await registerUser();

      const response = await listItems(tokens.accessToken).expect(200);

      expect(response.body as ItemPageDto).toEqual({ data: [], nextCursor: null, hasMore: false });
    });

    it.each([
      ['an unsortable field', '?sortBy=productName'],
      ['an unknown order', '?order=ascending'],
      ['a page beyond the ceiling', `?limit=${ITEMS_CONFIG.pagination.maxPageSize + 1}`],
      ['a page size of zero', '?limit=0'],
      ['a cursor that is not a marker', '?cursor=20'],
      ['a status outside the lifecycle', '?status=ARCHIVED'],
      ['a category outside the vocabulary', '?category=GROCERIES'],
      ['a filter we do not offer', '?brand=Nike'],
    ])('rejects %s with a 400', async (_case, query) => {
      const tokens = await registerUser();

      await listItems(tokens.accessToken, query).expect(400);
    });
  });

  describe('GET /items/:id', () => {
    it('reports an unknown id as not found', async () => {
      const tokens = await registerUser();

      await getItem(tokens.accessToken, randomUUID()).expect(404);
    });

    it('rejects an id that is not a marker at all', async () => {
      const tokens = await registerUser();

      await getItem(tokens.accessToken, 'not-an-id').expect(400);
    });
  });

  describe('PATCH /items/:id', () => {
    it('clears a brand when null is sent, and leaves untouched fields alone', async () => {
      const tokens = await registerUser();
      const created = await createItem(tokens.accessToken);

      const updated = (await patchItem(tokens.accessToken, created.id, { brand: null }).expect(200))
        .body as ItemResponseDto;

      expect(updated).toMatchObject({
        brand: null,
        productName: LINK_ITEM.productName,
        price: 129.99,
      });
    });

    it.each(['PURCHASED', 'SKIPPED'])('refuses to edit an item once it is %s', async (status) => {
      const tokens = await registerUser();
      const created = await createItem(tokens.accessToken);
      await patchStatus(tokens.accessToken, created.id, status).expect(200);

      const response = await patchItem(tokens.accessToken, created.id, { price: 1 }).expect(400);

      expect((response.body as ErrorResponse).message).toContain(status);
    });

    it.each([
      ['a source change', { source: 'MANUAL' }],
      ['a status change', { status: 'PURCHASED' }],
      ['a discovery date change', { discoveredAt: '2026-09-01T08:30:00.000Z' }],
      ['a null product name', { productName: null }],
      ['a blank product name', { productName: '  ' }],
      ['an unknown category', { category: 'GROCERIES' }],
      ['a sub-cent price', { price: 1.234 }],
    ])('rejects %s with a 400', async (_case, body) => {
      const tokens = await registerUser();
      const created = await createItem(tokens.accessToken);

      await patchItem(tokens.accessToken, created.id, body).expect(400);
    });

    it('accepts an empty patch as a no-op', async () => {
      const tokens = await registerUser();
      const created = await createItem(tokens.accessToken);

      const response = await patchItem(tokens.accessToken, created.id, {}).expect(200);

      expect(response.body as ItemResponseDto).toMatchObject({
        productName: LINK_ITEM.productName,
        price: 129.99,
      });
    });
  });

  describe('PATCH /items/:id/status', () => {
    it('allows a wishlist item to be skipped, and then nothing further', async () => {
      const tokens = await registerUser();
      const created = await createItem(tokens.accessToken);

      const skipped = (await patchStatus(tokens.accessToken, created.id, 'SKIPPED').expect(200))
        .body as ItemResponseDto;
      expect(skipped.status).toBe('SKIPPED');

      for (const status of ['PURCHASED', 'RETURNED', 'SKIPPED']) {
        await patchStatus(tokens.accessToken, created.id, status).expect(400);
      }
    });

    it('refuses to return an item that was never purchased', async () => {
      const tokens = await registerUser();
      const created = await createItem(tokens.accessToken);

      const response = await patchStatus(tokens.accessToken, created.id, 'RETURNED').expect(400);

      expect((response.body as ErrorResponse).message).toContain('WISHLIST');
      expect((response.body as ErrorResponse).message).toContain('RETURNED');
    });

    it.each([
      ['PAUSED, which only the pauses module may set', 'PAUSED'],
      ['WISHLIST, which is only ever the creation state', 'WISHLIST'],
      ['a status outside the lifecycle', 'ARCHIVED'],
    ])('rejects a request for %s', async (_case, status) => {
      const tokens = await registerUser();
      const created = await createItem(tokens.accessToken);

      await patchStatus(tokens.accessToken, created.id, status).expect(400);

      const unchanged = (await getItem(tokens.accessToken, created.id).expect(200))
        .body as ItemResponseDto;
      expect(unchanged.status).toBe('WISHLIST');
    });
  });

  describe('DELETE /items/:id', () => {
    it('removes a wishlist item the user entered by mistake', async () => {
      const tokens = await registerUser();
      const created = await createItem(tokens.accessToken);

      await deleteItem(tokens.accessToken, created.id).expect(204);

      await getItem(tokens.accessToken, created.id).expect(404);
      await expect(prismaService.item.count({ where: { id: created.id } })).resolves.toBe(0);
    });

    it.each(['PURCHASED', 'SKIPPED'])('keeps a %s item as history', async (status) => {
      const tokens = await registerUser();
      const created = await createItem(tokens.accessToken);
      await patchStatus(tokens.accessToken, created.id, status).expect(200);

      const response = await deleteItem(tokens.accessToken, created.id).expect(400);

      expect((response.body as ErrorResponse).message).toContain(status);
      await expect(prismaService.item.count({ where: { id: created.id } })).resolves.toBe(1);
    });

    it('reports an unknown id as not found', async () => {
      const tokens = await registerUser();

      await deleteItem(tokens.accessToken, randomUUID()).expect(404);
    });
  });

  describe("another user's items", () => {
    it('are invisible rather than forbidden, on every route that names an id', async () => {
      const owner = await registerUser();
      const stranger = await registerUser();
      const item = await createItem(owner.accessToken);

      // A 403 would confirm the id is real, which is exactly the existence
      // check a caller holding a valid token should not get.
      const read = await getItem(stranger.accessToken, item.id).expect(404);
      expect(read.body as ErrorResponse).toMatchObject({
        statusCode: 404,
        error: 'Not Found',
        path: `/api/v1/items/${item.id}`,
      });

      await patchItem(stranger.accessToken, item.id, { price: 1 }).expect(404);
      await patchStatus(stranger.accessToken, item.id, 'PURCHASED').expect(404);
      await deleteItem(stranger.accessToken, item.id).expect(404);

      // Nothing the stranger tried touched the item.
      const unchanged = (await getItem(owner.accessToken, item.id).expect(200))
        .body as ItemResponseDto;
      expect(unchanged).toEqual(item);
    });

    it("do not appear in a stranger's list, even with matching filters", async () => {
      const owner = await registerUser();
      const stranger = await registerUser();
      await createItem(owner.accessToken);

      const page = (
        await listItems(stranger.accessToken, '?status=WISHLIST&category=FASHION').expect(200)
      ).body as ItemPageDto;

      expect(page.data).toEqual([]);
    });
  });

  describe('authentication is required on every items route', () => {
    it.each([
      ['POST', '/api/v1/items', LINK_ITEM],
      ['GET', '/api/v1/items', {}],
      ['GET', '/api/v1/items/33333333-3333-4333-8333-333333333333', {}],
      ['PATCH', '/api/v1/items/33333333-3333-4333-8333-333333333333', { price: 1 }],
      [
        'PATCH',
        '/api/v1/items/33333333-3333-4333-8333-333333333333/status',
        { status: 'PURCHASED' },
      ],
      ['DELETE', '/api/v1/items/33333333-3333-4333-8333-333333333333', {}],
    ] as const)('rejects an unauthenticated %s %s with a 401', async (method, path, body) => {
      const response = await request(server)
        [method.toLowerCase() as 'get' | 'post' | 'patch' | 'delete'](path)
        .set('X-Forwarded-For', uniqueClientIp())
        .send(body)
        .expect(401);

      expect(response.body as ErrorResponse).toEqual({
        statusCode: 401,
        message: 'Unauthorized',
        error: 'Unauthorized',
        timestamp: expect.any(String) as string,
        path,
      });
    });

    it('rejects a token signed for a user that no longer exists', async () => {
      const tokens = await registerUser();
      const created = await createItem(tokens.accessToken);

      await request(server)
        .delete('/api/v1/users/me')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .set('X-Forwarded-For', uniqueClientIp())
        .send({ currentPassword: PASSWORD })
        .expect(204);

      // The access token still verifies for its remaining lifetime, but the
      // user's items went with the cascade.
      await getItem(tokens.accessToken, created.id).expect(404);
      await expect(prismaService.item.count({ where: { id: created.id } })).resolves.toBe(0);
    });

    it('documents the items routes in Swagger', async () => {
      const response = await request(server).get('/api/docs-json').expect(200);

      const document = response.body as { paths: Record<string, unknown> };
      expect(Object.keys(document.paths)).toEqual(
        expect.arrayContaining([
          '/api/v1/items',
          '/api/v1/items/from-screenshot',
          '/api/v1/items/{id}',
          '/api/v1/items/{id}/status',
        ]),
      );
    });
  });

  async function storedPrice(itemId: string): Promise<string> {
    const item = await prismaService.item.findUniqueOrThrow({
      where: { id: itemId },
      select: { price: true },
    });
    return item.price.toFixed(2);
  }

  async function profileId(accessToken: string): Promise<string> {
    const response = await authenticated('get', '/api/v1/users/me', accessToken).expect(200);
    return (response.body as { id: string }).id;
  }
});
