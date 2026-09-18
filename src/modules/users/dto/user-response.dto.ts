import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose, plainToInstance } from 'class-transformer';
import { Prisma } from '../../../generated/prisma/client';

/** The Prisma row a profile response is built from. */
export interface UserProfileRow {
  id: string;
  email: string;
  currency: string;
  monthlyBudget: Prisma.Decimal;
  defaultPauseHours: number;
  createdAt: Date;
}

/**
 * The only shape a user profile is ever serialised in.
 *
 * `@Exclude()` on the class inverts class-transformer's default: a field is
 * omitted unless it opts in with `@Expose()`. That way a column added to the
 * User model later — another password hash, a payment token — cannot leak by
 * being forgotten here, which is exactly what an ad-hoc `delete user.x` on the
 * raw Prisma object would allow (.cursorrules §5).
 */
@Exclude()
export class UserResponseDto {
  @Expose()
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @Expose()
  @ApiProperty({ example: 'shopper@example.com' })
  email!: string;

  @Expose()
  @ApiProperty({ example: 'USD', description: 'ISO 4217 code' })
  currency!: string;

  @Expose()
  @ApiProperty({ example: 500, description: 'Monthly discretionary budget' })
  monthlyBudget!: number;

  @Expose()
  @ApiProperty({ example: 24, description: 'Default cooling-off length in hours' })
  defaultPauseHours!: number;

  @Expose()
  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  static fromUser(user: UserProfileRow): UserResponseDto {
    // Decimal and Date are class instances, and class-transformer clones an
    // unrecognised instance by calling its constructor — which Decimal rejects.
    // Converting to the wire types first sidesteps that: JSON has no decimal
    // type, so money travels as a number (exact at Decimal(12, 2) precision)
    // and timestamps as ISO 8601 strings.
    const wireValues = {
      ...user,
      monthlyBudget: Number(user.monthlyBudget),
      createdAt: user.createdAt.toISOString(),
    };

    // excludeExtraneousValues drops anything without an @Expose(), so the
    // instance carries only the six documented fields.
    return plainToInstance(UserResponseDto, wireValues, { excludeExtraneousValues: true });
  }
}
