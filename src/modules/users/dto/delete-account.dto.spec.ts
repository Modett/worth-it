import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import { AUTH_CONFIG } from '../../auth/auth.config';
import { DeleteAccountDto } from './delete-account.dto';

async function failedProperties(payload: Record<string, unknown>): Promise<string[]> {
  const errors: ValidationError[] = await validate(plainToInstance(DeleteAccountDto, payload));
  return errors.map((error) => error.property);
}

describe('DeleteAccountDto', () => {
  it('accepts the current password as confirmation', async () => {
    await expect(failedProperties({ currentPassword: 'correct-horse-battery' })).resolves.toEqual(
      [],
    );
  });

  it('refuses to delete without a confirmation password', async () => {
    await expect(failedProperties({})).resolves.toEqual(['currentPassword']);
  });

  it('rejects a password longer than bcrypt can hash', async () => {
    await expect(
      failedProperties({ currentPassword: 'a'.repeat(AUTH_CONFIG.passwordMaxLength + 1) }),
    ).resolves.toEqual(['currentPassword']);
  });
});
