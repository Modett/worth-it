import {
  ArgumentsHost,
  BadRequestException,
  HttpStatus,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { ErrorResponse } from './error-response.interface';

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  let status: jest.Mock;
  let json: jest.Mock;
  let host: ArgumentsHost;

  beforeEach(() => {
    filter = new AllExceptionsFilter();
    json = jest.fn();
    status = jest.fn(() => ({ json }));
    host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({ method: 'GET', url: '/api/v1/items/123' }),
      }),
    } as unknown as ArgumentsHost;

    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function sentBody(): ErrorResponse {
    const [firstCall] = json.mock.calls as [[ErrorResponse]];
    return firstCall[0];
  }

  it('formats HttpExceptions into the standard shape', () => {
    filter.catch(new NotFoundException('Item not found'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(sentBody()).toEqual({
      statusCode: 404,
      message: 'Item not found',
      error: 'Not Found',
      timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) as string,
      path: '/api/v1/items/123',
    });
  });

  it('preserves the array of messages produced by ValidationPipe', () => {
    filter.catch(new BadRequestException(['price must be a number', 'name is required']), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(sentBody()).toMatchObject({
      statusCode: 400,
      message: ['price must be a number', 'name is required'],
      error: 'Bad Request',
    });
  });

  it('hides unknown errors behind a generic 500 and logs them', () => {
    filter.catch(new Error('connection string contains password=hunter2'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(sentBody()).toMatchObject({
      statusCode: 500,
      message: 'Internal server error',
      error: 'Internal Server Error',
    });
    expect(JSON.stringify(sentBody())).not.toContain('hunter2');
    expect(Logger.prototype.error).toHaveBeenCalledTimes(1);
  });

  it('does not log expected 4xx client errors', () => {
    filter.catch(new BadRequestException('bad input'), host);

    expect(Logger.prototype.error).not.toHaveBeenCalled();
  });

  it('maps Prisma unique-constraint violations to 409 without leaking driver details', () => {
    const prismaError = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed on the fields: (`email`)',
      { code: 'P2002', clientVersion: 'test' },
    );

    filter.catch(prismaError, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(sentBody()).toMatchObject({
      statusCode: 409,
      message: 'A record with the same unique value already exists',
      error: 'Conflict',
    });
    expect(JSON.stringify(sentBody())).not.toContain('Unique constraint failed');
  });

  it('treats unmapped Prisma errors as internal failures', () => {
    const prismaError = new Prisma.PrismaClientKnownRequestError('Transaction API error', {
      code: 'P2028',
      clientVersion: 'test',
    });

    filter.catch(prismaError, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(sentBody().message).toBe('Internal server error');
  });
});
