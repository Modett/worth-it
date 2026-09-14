import { ApiProperty } from '@nestjs/swagger';

/**
 * Signup confirms the account exists but issues no tokens — the client calls
 * /auth/login next. Keeping the two steps separate means there is exactly one
 * code path that mints tokens.
 */
export class SignupResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'shopper@example.com' })
  email!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}
