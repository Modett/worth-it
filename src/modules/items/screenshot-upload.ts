import { ArgumentsHost, Catch, ExceptionFilter, PayloadTooLargeException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage, MulterError } from 'multer';
import { ErrorResponse } from '../../common/filters/error-response.interface';
import { InvalidScreenshotException } from './exceptions/items.exceptions';
import { ITEMS_CONFIG } from './items.config';

const ALLOWED_MIME_TYPES = new Set<string>(ITEMS_CONFIG.screenshot.allowedMimeTypes);

export function isAllowedScreenshotMime(mimeType: string): boolean {
  return ALLOWED_MIME_TYPES.has(mimeType);
}

export function screenshotUploadInterceptor(): ReturnType<typeof FileInterceptor> {
  return FileInterceptor(ITEMS_CONFIG.screenshot.fieldName, {
    storage: memoryStorage(),
    limits: { fileSize: ITEMS_CONFIG.screenshot.maxUploadBytes, files: 1 },
    fileFilter: (_request, file, callback) => {
      if (!isAllowedScreenshotMime(file.mimetype)) {
        callback(
          new InvalidScreenshotException(
            `Image type '${file.mimetype}' is not supported; upload a JPEG, PNG or WebP image`,
          ),
          false,
        );
        return;
      }
      callback(null, true);
    },
  });
}

function isOversizeUpload(exception: MulterError | PayloadTooLargeException): boolean {
  return (
    exception instanceof PayloadTooLargeException ||
    (exception instanceof MulterError && exception.code === 'LIMIT_FILE_SIZE')
  );
}

/**
 * Nest transforms Multer's LIMIT_FILE_SIZE into PayloadTooLargeException (413).
 * This route promises a 400 with the 8MB ceiling named, so both shapes are
 * mapped here rather than leaking a 413.
 */
@Catch(MulterError, PayloadTooLargeException)
export class ScreenshotUploadExceptionFilter implements ExceptionFilter {
  catch(exception: MulterError | PayloadTooLargeException, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();
    const message = isOversizeUpload(exception)
      ? `Image must be at most ${ITEMS_CONFIG.screenshot.maxUploadBytes} bytes`
      : 'Invalid screenshot upload';

    const body: ErrorResponse = {
      statusCode: 400,
      message,
      error: 'Bad Request',
      timestamp: new Date().toISOString(),
      path: request.url,
    };
    response.status(400).json(body);
  }
}
