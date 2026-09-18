import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNumber, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { USERS_CONFIG } from '../users.config';

/**
 * Onboarding and preference fields only. Email and password have their own
 * flows, and everything else on the User model is derived rather than
 * user-editable.
 */
export class UpdateProfileDto {
  @ApiPropertyOptional({
    example: 'GBP',
    description: 'ISO 4217 code: exactly three uppercase letters',
    minLength: USERS_CONFIG.currency.length,
    maxLength: USERS_CONFIG.currency.length,
  })
  @IsOptional()
  @IsString()
  @Matches(USERS_CONFIG.currency.pattern, {
    message: 'currency must be three uppercase letters, e.g. USD',
  })
  currency?: string;

  @ApiPropertyOptional({
    example: 750.5,
    minimum: USERS_CONFIG.monthlyBudget.min,
    maximum: USERS_CONFIG.monthlyBudget.max,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: USERS_CONFIG.monthlyBudget.decimalPlaces })
  @Min(USERS_CONFIG.monthlyBudget.min)
  @Max(USERS_CONFIG.monthlyBudget.max)
  monthlyBudget?: number;

  @ApiPropertyOptional({
    example: 48,
    minimum: USERS_CONFIG.defaultPauseHours.min,
    maximum: USERS_CONFIG.defaultPauseHours.max,
  })
  @IsOptional()
  @IsInt()
  @Min(USERS_CONFIG.defaultPauseHours.min)
  @Max(USERS_CONFIG.defaultPauseHours.max)
  defaultPauseHours?: number;
}
