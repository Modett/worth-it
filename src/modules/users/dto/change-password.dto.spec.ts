import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import { AUTH_CONFIG } from '../../auth/auth.config';
import { ChangePasswordDto } from './change-password.dto';

const CURRENT_PASSWORD = 'correct-horse-battery';

async function failedProperties(payload: Record<string, unknown>): Promise<string[]> {
  const errors: ValidationError[] = await validate(plainToInstance(ChangePasswordDto, payload));
  return errors.map((error) => error.property);
}

describe('ChangePasswordDto', () => {
  it('accepts a new password that meets the length rule', async () => {
    await expect(
      failedProperties({
        currentPassword: CURRENT_PASSWORD,
        newPassword: 'a-brand-new-secret',
      }),
    ).resolves.toEqual([]);
  });

  it('requires both passwords', async () => {
    await expect(failedProperties({})).resolves.toEqual(
      expect.arrayContaining(['currentPassword', 'newPassword']),
    );
  });

  it('applies the same minimum length as signup', async () => {
    const tooShort = 'a'.repeat(AUTH_CONFIG.passwordMinLength - 1);

    await expect(
      failedProperties({ currentPassword: CURRENT_PASSWORD, newPassword: tooShort }),
    ).resolves.toEqual(['newPassword']);
  });

  it("applies bcrypt's 72-byte ceiling to both fields", async () => {
    const tooLong = 'a'.repeat(AUTH_CONFIG.passwordMaxLength + 1);

    await expect(
      failedProperties({ currentPassword: tooLong, newPassword: tooLong }),
    ).resolves.toEqual(expect.arrayContaining(['currentPassword', 'newPassword']));
  });

  it('rejects a new password identical to the current one', async () => {
    await expect(
      failedProperties({ currentPassword: CURRENT_PASSWORD, newPassword: CURRENT_PASSWORD }),
    ).resolves.toEqual(['newPassword']);
  });

  it('places no minimum on the current password, whatever rule it was created under', async () => {
    await expect(
      failedProperties({ currentPassword: 'old', newPassword: 'a-brand-new-secret' }),
    ).resolves.toEqual([]);
  });
});
