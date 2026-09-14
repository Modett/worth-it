import * as bcrypt from 'bcrypt';
import { AUTH_CONFIG } from './auth.config';
import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const service = new PasswordService();
  const password = 'correct-horse-battery';

  it('produces a bcrypt hash at the cost factor required by .cursorrules §5', async () => {
    const hash = await service.hash(password);

    expect(hash).not.toContain(password);
    expect(bcrypt.getRounds(hash)).toBe(AUTH_CONFIG.bcryptCost);
    expect(AUTH_CONFIG.bcryptCost).toBeGreaterThanOrEqual(12);
  });

  it('salts each hash, so identical passwords never share a digest', async () => {
    const [first, second] = await Promise.all([service.hash(password), service.hash(password)]);

    expect(first).not.toBe(second);
  });

  it('verifies a correct password', async () => {
    const hash = await service.hash(password);

    await expect(service.verify(password, hash)).resolves.toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await service.hash(password);

    await expect(service.verify('not-the-password', hash)).resolves.toBe(false);
  });

  it('exposes an equalising comparison that always resolves without throwing', async () => {
    await expect(service.wasteComparison('anything')).resolves.toBeUndefined();
  });
});
