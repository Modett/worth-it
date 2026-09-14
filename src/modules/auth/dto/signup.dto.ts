import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { AUTH_CONFIG } from '../auth.config';

// bcrypt only hashes the first 72 bytes, so anything longer is silently
// truncated; reject it instead of pretending the extra characters count.
const PASSWORD_MAX_LENGTH = 72;
const EMAIL_MAX_LENGTH = 254;

export class SignupDto {
  @ApiProperty({ example: 'shopper@example.com', maxLength: EMAIL_MAX_LENGTH })
  @IsEmail()
  @MaxLength(EMAIL_MAX_LENGTH)
  email!: string;

  @ApiProperty({
    example: 'correct-horse-battery',
    minLength: AUTH_CONFIG.passwordMinLength,
    maxLength: PASSWORD_MAX_LENGTH,
  })
  @IsString()
  @MinLength(AUTH_CONFIG.passwordMinLength)
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;
}
