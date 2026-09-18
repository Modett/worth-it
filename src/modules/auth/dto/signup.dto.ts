import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { AUTH_CONFIG } from '../auth.config';

const EMAIL_MAX_LENGTH = 254;

export class SignupDto {
  @ApiProperty({ example: 'shopper@example.com', maxLength: EMAIL_MAX_LENGTH })
  @IsEmail()
  @MaxLength(EMAIL_MAX_LENGTH)
  email!: string;

  @ApiProperty({
    example: 'correct-horse-battery',
    minLength: AUTH_CONFIG.passwordMinLength,
    maxLength: AUTH_CONFIG.passwordMaxLength,
  })
  @IsString()
  @MinLength(AUTH_CONFIG.passwordMinLength)
  @MaxLength(AUTH_CONFIG.passwordMaxLength)
  password!: string;
}
