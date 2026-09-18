import { ArgumentsHost, PayloadTooLargeException } from '@nestjs/common';
import { MulterError } from 'multer';
import { ErrorResponse } from '../../common/filters/error-response.interface';
import { ITEMS_CONFIG } from './items.config';
import { ScreenshotUploadExceptionFilter } from './screenshot-upload';

describe('ScreenshotUploadExceptionFilter', () => {
  it('maps Nest 413 from an oversized screenshot to a 400 that names the ceiling', () => {
    const json = jest.fn();
    const status = jest.fn(() => ({ json }));
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({ url: '/api/v1/items/from-screenshot' }),
      }),
    } as unknown as ArgumentsHost;

    new ScreenshotUploadExceptionFilter().catch(new PayloadTooLargeException(), host);

    expect(status).toHaveBeenCalledWith(400);
    expect((json.mock.calls[0] as [ErrorResponse])[0]).toMatchObject({
      statusCode: 400,
      error: 'Bad Request',
      message: `Image must be at most ${ITEMS_CONFIG.screenshot.maxUploadBytes} bytes`,
      path: '/api/v1/items/from-screenshot',
    });
  });

  it('maps a raw Multer LIMIT_FILE_SIZE the same way', () => {
    const json = jest.fn();
    const status = jest.fn(() => ({ json }));
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({ url: '/api/v1/items/from-screenshot' }),
      }),
    } as unknown as ArgumentsHost;

    new ScreenshotUploadExceptionFilter().catch(new MulterError('LIMIT_FILE_SIZE'), host);

    expect(status).toHaveBeenCalledWith(400);
    expect((json.mock.calls[0] as [ErrorResponse])[0].message).toContain(
      String(ITEMS_CONFIG.screenshot.maxUploadBytes),
    );
  });
});
