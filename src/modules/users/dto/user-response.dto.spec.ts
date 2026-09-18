import { instanceToPlain } from 'class-transformer';
import { Prisma } from '../../../generated/prisma/client';
import { UserProfileRow, UserResponseDto } from './user-response.dto';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const CREATED_AT = new Date('2026-09-13T10:00:00.000Z');

/**
 * Overrides are deliberately untyped so tests can add columns the DTO does not
 * know about — that is the leak this DTO exists to prevent.
 */
function row(overrides: Record<string, unknown> = {}): UserProfileRow {
  return {
    id: USER_ID,
    email: 'shopper@example.com',
    currency: 'USD',
    monthlyBudget: new Prisma.Decimal('500.00'),
    defaultPauseHours: 24,
    createdAt: CREATED_AT,
    ...overrides,
  };
}

describe('UserResponseDto', () => {
  it('exposes exactly the six documented profile fields', () => {
    const dto = UserResponseDto.fromUser(row());

    expect(Object.keys(instanceToPlain(dto)).sort()).toEqual([
      'createdAt',
      'currency',
      'defaultPauseHours',
      'email',
      'id',
      'monthlyBudget',
    ]);
  });

  it('drops the password hash instead of relying on the caller to strip it', () => {
    const dto = UserResponseDto.fromUser(row({ passwordHash: 'a-bcrypt-hash' }));

    expect(dto).not.toHaveProperty('passwordHash');
    expect(JSON.stringify(dto)).not.toContain('a-bcrypt-hash');
  });

  it('drops any field added to the User model later that has not opted in', () => {
    const dto = UserResponseDto.fromUser(
      row({ updatedAt: new Date(), stripeCustomerId: 'cus_123' }),
    );

    expect(dto).not.toHaveProperty('updatedAt');
    expect(dto).not.toHaveProperty('stripeCustomerId');
  });

  it('serialises the Decimal budget as a JSON number, keeping the cents', () => {
    const dto = UserResponseDto.fromUser(row({ monthlyBudget: new Prisma.Decimal('1234.56') }));

    expect(dto.monthlyBudget).toBe(1234.56);
    expect(typeof dto.monthlyBudget).toBe('number');
  });

  it('serialises createdAt as an ISO 8601 string', () => {
    const dto = UserResponseDto.fromUser(row());

    expect(dto.createdAt).toBe(CREATED_AT.toISOString());
  });
});
