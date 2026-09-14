import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Prisma } from '../../generated/prisma/client';
import { ErrorResponse } from './error-response.interface';

interface NestErrorBody {
  message?: string | string[];
  error?: string;
}

/**
 * Prisma error codes that map cleanly onto HTTP semantics. Anything else from
 * the database layer is an unexpected failure and is reported as a 500
 * without leaking driver details.
 */
const PRISMA_ERROR_STATUS: Readonly<Record<string, HttpStatus>> = {
  P2002: HttpStatus.CONFLICT, // unique constraint violation
  P2025: HttpStatus.NOT_FOUND, // record required by the operation not found
};

const PRISMA_ERROR_MESSAGE: Readonly<Record<string, string>> = {
  P2002: 'A record with the same unique value already exists',
  P2025: 'The requested record does not exist',
};

const INTERNAL_ERROR_MESSAGE = 'Internal server error';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();

    const { statusCode, message, error } = this.describe(exception);

    if (isServerError(statusCode)) {
      // Only 5xx are logged at error level: 4xx are expected client behaviour
      // and would otherwise drown real failures in noise.
      this.logger.error(
        { method: request.method, path: request.url, statusCode },
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: ErrorResponse = {
      statusCode,
      message,
      error,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    response.status(statusCode).json(body);
  }

  private describe(exception: unknown): Pick<ErrorResponse, 'statusCode' | 'message' | 'error'> {
    if (exception instanceof HttpException) {
      return this.describeHttpException(exception);
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const statusCode = PRISMA_ERROR_STATUS[exception.code];
      if (statusCode !== undefined) {
        return {
          statusCode,
          message: PRISMA_ERROR_MESSAGE[exception.code],
          error: httpStatusText(statusCode),
        };
      }
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: INTERNAL_ERROR_MESSAGE,
      error: httpStatusText(HttpStatus.INTERNAL_SERVER_ERROR),
    };
  }

  private describeHttpException(
    exception: HttpException,
  ): Pick<ErrorResponse, 'statusCode' | 'message' | 'error'> {
    const statusCode = exception.getStatus();
    const rawBody = exception.getResponse();

    if (typeof rawBody === 'string') {
      return { statusCode, message: rawBody, error: httpStatusText(statusCode) };
    }

    const body = rawBody as NestErrorBody;
    return {
      statusCode,
      message: body.message ?? exception.message,
      error: body.error ?? httpStatusText(statusCode),
    };
  }
}

const FIRST_SERVER_ERROR_STATUS: number = HttpStatus.INTERNAL_SERVER_ERROR;

function isServerError(statusCode: number): boolean {
  return statusCode >= FIRST_SERVER_ERROR_STATUS;
}

/** "INTERNAL_SERVER_ERROR" -> "Internal Server Error". */
function httpStatusText(statusCode: HttpStatus): string {
  const name = HttpStatus[statusCode] ?? 'Error';
  return name
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
