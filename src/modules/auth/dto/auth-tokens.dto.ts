import { ApiProperty } from '@nestjs/swagger';
import { AUTH_CONFIG } from '../auth.config';

export const TOKEN_TYPE = 'Bearer';

/** Response body for login and refresh. */
export class AuthTokensDto {
  @ApiProperty({ description: 'JWT to send as `Authorization: Bearer <token>`' })
  accessToken!: string;

  @ApiProperty({
    description: 'Opaque single-use token for POST /auth/refresh. Rotated on every use.',
  })
  refreshToken!: string;

  @ApiProperty({ example: TOKEN_TYPE })
  tokenType!: typeof TOKEN_TYPE;

  @ApiProperty({
    description: 'Access token lifetime in seconds',
    example: AUTH_CONFIG.accessTokenTtlSeconds,
  })
  expiresIn!: number;
}
