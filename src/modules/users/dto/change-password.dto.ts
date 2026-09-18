import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { DiffersFrom } from '../../../common/decorators/differs-from.decorator';
import { AUTH_CONFIG } from '../../auth/auth.config';

export class ChangePasswordDto {
  @ApiProperty({
    description: 'Verified against the stored hash before the change is applied',
    maxLength: AUTH_CONFIG.passwordMaxLength,
  })
  @IsString()
  // No minimum: the rule that applies is whatever was in force when the
  // account was created. The maximum is bcrypt's — a longer string could never
  // be the stored password, so reject it rather than hash it.
  @MaxLength(AUTH_CONFIG.passwordMaxLength)
  currentPassword!: string;

  @ApiProperty({
    minLength: AUTH_CONFIG.passwordMinLength,
    maxLength: AUTH_CONFIG.passwordMaxLength,
  })
  @IsString()
  @MinLength(AUTH_CONFIG.passwordMinLength)
  @MaxLength(AUTH_CONFIG.passwordMaxLength)
  @DiffersFrom('currentPassword', { message: 'newPassword must differ from currentPassword' })
  newPassword!: string;
}
