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
import { ItemResponseDto } from '../src/modules/items/dto/item-response.dto';
import { ScoreResponseDto } from '../src/modules/scoring/dto/score-response.dto';
import { SCORE_LABELS } from '../src/modules/scoring/scoring.engine';
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

describe('Scoring (e2e)', () => {
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
    return `scorer-${randomUUID()}@example.com`;
  }

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

  async function createItem(accessToken: string): Promise<ItemResponseDto> {
    const response = await authenticated('post', '/api/v1/items', accessToken)
      .send(LINK_ITEM)
      .expect(201);
    return response.body as ItemResponseDto;
  }

  function postScore(accessToken: string, itemId: string, similarOwned: boolean): request.Test {
    return authenticated('post', `/api/v1/items/${itemId}/score`, accessToken).send({
      similarOwned,
    });
  }

  function getScore(accessToken: string, itemId: string): request.Test {
    return authenticated('get', `/api/v1/items/${itemId}/score`, accessToken);
  }

  function similarOwnedWeight(body: ScoreResponseDto): number | undefined {
    return body.factorBreakdown.find(
      (factor) =>
        factor.label === SCORE_LABELS.similarOwnedYes ||
        factor.label === SCORE_LABELS.similarOwnedNo,
    )?.weight;
  }

  describe('POST /items/:id/score then GET', () => {
    it('computes a score, returns it on GET, and replaces the row in place on re-score', async () => {
      const tokens = await registerUser();
      const item = await createItem(tokens.accessToken);

      const first = (await postScore(tokens.accessToken, item.id, false).expect(201))
        .body as ScoreResponseDto;

      expect(first).toMatchObject({
        itemId: item.id,
        pauseHours: 24,
      });
      expect(first.score).toBeGreaterThanOrEqual(0);
      expect(first.score).toBeLessThanOrEqual(100);
      expect(similarOwnedWeight(first)).toBe(0);
      expect(first.factorBreakdown.length).toBeGreaterThan(0);

      const fetched = (await getScore(tokens.accessToken, item.id).expect(200))
        .body as ScoreResponseDto;
      expect(fetched).toEqual(first);

      await prismaService.regretScore.update({
        where: { itemId: item.id },
        data: { computedAt: new Date('2026-01-01T00:00:00.000Z') },
      });

      const second = (await postScore(tokens.accessToken, item.id, true).expect(201))
        .body as ScoreResponseDto;

      expect(second.itemId).toBe(item.id);
      expect(similarOwnedWeight(second)).toBe(20);
      expect(second.factorBreakdown).not.toEqual(first.factorBreakdown);
      expect(new Date(second.computedAt).getTime()).toBeGreaterThan(
        new Date(first.computedAt).getTime(),
      );

      await expect(prismaService.regretScore.count({ where: { itemId: item.id } })).resolves.toBe(
        1,
      );

      const stored = await prismaService.regretScore.findUniqueOrThrow({
        where: { itemId: item.id },
      });
      expect(stored.id).toBe(first.id);
      expect(stored.id).toBe(second.id);
    });

    it('scores a PAUSED item', async () => {
      const tokens = await registerUser();
      const item = await createItem(tokens.accessToken);
      await prismaService.item.update({
        where: { id: item.id },
        data: { status: 'PAUSED' },
      });

      await postScore(tokens.accessToken, item.id, false).expect(201);
    });

    it('rejects scoring a PURCHASED item with a 400', async () => {
      const tokens = await registerUser();
      const item = await createItem(tokens.accessToken);
      await authenticated('patch', `/api/v1/items/${item.id}/status`, tokens.accessToken)
        .send({ status: 'PURCHASED' })
        .expect(200);

      const response = await postScore(tokens.accessToken, item.id, false).expect(400);

      expect((response.body as ErrorResponse).message).toContain('PURCHASED');
      await expect(prismaService.regretScore.count({ where: { itemId: item.id } })).resolves.toBe(
        0,
      );
    });

    it("reports another user's item as not found, not forbidden", async () => {
      const owner = await registerUser();
      const stranger = await registerUser();
      const item = await createItem(owner.accessToken);

      const response = await postScore(stranger.accessToken, item.id, false).expect(404);

      expect(response.body as ErrorResponse).toMatchObject({
        statusCode: 404,
        message: 'Item not found',
        error: 'Not Found',
        path: `/api/v1/items/${item.id}/score`,
      });
    });

    it.each([
      ['a missing similarOwned', {}],
      ['a string similarOwned', { similarOwned: 'true' }],
      ['an extra field', { similarOwned: false, inferred: true }],
    ])('rejects %s with a 400', async (_case, body) => {
      const tokens = await registerUser();
      const item = await createItem(tokens.accessToken);

      await authenticated('post', `/api/v1/items/${item.id}/score`, tokens.accessToken)
        .send(body)
        .expect(400);
    });
  });

  describe('GET /items/:id/score', () => {
    it('uses a distinct 404 message when the item has never been scored', async () => {
      const tokens = await registerUser();
      const item = await createItem(tokens.accessToken);

      const response = await getScore(tokens.accessToken, item.id).expect(404);

      expect(response.body as ErrorResponse).toMatchObject({
        statusCode: 404,
        message: 'No regret score has been computed for this item',
        error: 'Not Found',
      });
      expect((response.body as ErrorResponse).message).not.toBe('Item not found');
    });

    it('reports an unknown item as Item not found, not as an unscored item', async () => {
      const tokens = await registerUser();

      const response = await getScore(tokens.accessToken, randomUUID()).expect(404);

      expect((response.body as ErrorResponse).message).toBe('Item not found');
    });
  });

  describe('authentication is required', () => {
    it.each([
      ['POST', '/api/v1/items/33333333-3333-4333-8333-333333333333/score', { similarOwned: false }],
      ['GET', '/api/v1/items/33333333-3333-4333-8333-333333333333/score', {}],
    ] as const)('rejects an unauthenticated %s %s with a 401', async (method, path, body) => {
      const response = await request(server)
        [method.toLowerCase() as 'get' | 'post'](path)
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

    it('documents the score routes in Swagger', async () => {
      const response = await request(server).get('/api/docs-json').expect(200);

      const document = response.body as { paths: Record<string, unknown> };
      expect(Object.keys(document.paths)).toEqual(
        expect.arrayContaining(['/api/v1/items/{id}/score']),
      );
    });
  });
});
