import { HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { Response } from 'express';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { HealthResponseDto } from './dto/health-response.dto';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

describe('HealthController', () => {
  let controller: HealthController;
  let healthService: { check: jest.Mock };
  let response: { status: jest.Mock };

  const healthy: HealthResponseDto = {
    status: 'ok',
    db: 'ok',
    redis: 'ok',
    timestamp: '2026-09-13T08:00:00.000Z',
  };

  beforeEach(async () => {
    healthService = { check: jest.fn() };
    response = { status: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: HealthService, useValue: healthService }],
    }).compile();

    controller = moduleRef.get(HealthController);
  });

  it('returns the service result with a 200 when healthy', async () => {
    healthService.check.mockResolvedValue(healthy);

    const result = await controller.check(response as unknown as Response);

    expect(result).toEqual(healthy);
    expect(response.status).toHaveBeenCalledWith(HttpStatus.OK);
  });

  it('returns a 503 with the same body when degraded', async () => {
    const degraded: HealthResponseDto = { ...healthy, status: 'degraded', redis: 'error' };
    healthService.check.mockResolvedValue(degraded);

    const result = await controller.check(response as unknown as Response);

    expect(result).toEqual(degraded);
    expect(response.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
  });

  it('is marked @Public() so it works without a token', () => {
    const reflector = new Reflector();
    expect(reflector.get<boolean>(IS_PUBLIC_KEY, HealthController.prototype.check)).toBe(true);
  });
});
