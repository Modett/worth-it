import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';
import { AUTH_CONFIG } from '../../auth/auth.config';

/**
 * Deleting an account destroys every item, score and pause the user has, so it
 * is held to the same bar as a password change: a stolen access token alone is
 * not enough.
 */
export class DeleteAccountDto {
  @ApiProperty({ description: 'Current password, as confirmation of a destructive action' })
  @IsString()
  @MaxLength(AUTH_CONFIG.passwordMaxLength)
  currentPassword!: string;
}
