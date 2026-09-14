import { ValidationPipe } from '@nestjs/common';

/**
 * The one ValidationPipe configuration used app-wide. Unknown properties are
 * rejected (not just stripped) so clients can't smuggle fields past DTOs, and
 * payloads are transformed into DTO class instances so class-transformer
 * decorators (e.g. `@Exclude()`) apply consistently.
 */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: false },
    stopAtFirstError: false,
  });
}
