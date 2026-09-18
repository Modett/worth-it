import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import { USERS_CONFIG } from '../users.config';
import { UpdateProfileDto } from './update-profile.dto';

/**
 * The bounds on these three fields are the module's only input rules, so they
 * are asserted here at the DTO — the single place they are enforced — rather
 * than being duplicated as defensive checks in UsersService.
 */
async function failedProperties(payload: Record<string, unknown>): Promise<string[]> {
  const errors: ValidationError[] = await validate(plainToInstance(UpdateProfileDto, payload));
  return errors.map((error) => error.property);
}

describe('UpdateProfileDto', () => {
  it('accepts a payload with all three preferences', async () => {
    await expect(
      failedProperties({ currency: 'GBP', monthlyBudget: 750.5, defaultPauseHours: 48 }),
    ).resolves.toEqual([]);
  });

  it('accepts an empty payload, since every field is optional', async () => {
    await expect(failedProperties({})).resolves.toEqual([]);
  });

  describe('currency', () => {
    it.each(['USD', 'GBP', 'JPY'])('accepts the ISO 4217 shape %s', async (currency) => {
      await expect(failedProperties({ currency })).resolves.toEqual([]);
    });

    it.each([
      ['lower case', 'usd'],
      ['mixed case', 'Usd'],
      ['two letters', 'US'],
      ['four letters', 'USDX'],
      ['digits', '840'],
      ['padded', ' USD'],
      ['empty', ''],
    ])('rejects %s', async (_case, currency) => {
      await expect(failedProperties({ currency })).resolves.toEqual(['currency']);
    });

    it('rejects a non-string', async () => {
      await expect(failedProperties({ currency: 3 })).resolves.toEqual(['currency']);
    });
  });

  describe('monthlyBudget', () => {
    it.each([USERS_CONFIG.monthlyBudget.min, 500, 1234.56, USERS_CONFIG.monthlyBudget.max])(
      'accepts %s',
      async (monthlyBudget) => {
        await expect(failedProperties({ monthlyBudget })).resolves.toEqual([]);
      },
    );

    it.each([
      ['zero', 0],
      ['a negative amount', -1],
      ['above the ceiling', USERS_CONFIG.monthlyBudget.max + 0.01],
      ['an order of magnitude too large', 100_000_000],
      // Decimal(12, 2) would silently round this, so it is rejected instead.
      ['more than two decimal places', 10.123],
      ['a numeric string', '500'],
      ['not a number at all', 'lots'],
    ])('rejects %s', async (_case, monthlyBudget) => {
      await expect(failedProperties({ monthlyBudget })).resolves.toEqual(['monthlyBudget']);
    });
  });

  describe('defaultPauseHours', () => {
    it.each([USERS_CONFIG.defaultPauseHours.min, 24, USERS_CONFIG.defaultPauseHours.max])(
      'accepts %s hours',
      async (defaultPauseHours) => {
        await expect(failedProperties({ defaultPauseHours })).resolves.toEqual([]);
      },
    );

    it.each([
      ['zero', 0],
      ['a negative count', -24],
      ['longer than a week', USERS_CONFIG.defaultPauseHours.max + 1],
      ['a fractional hour', 1.5],
      ['a numeric string', '24'],
    ])('rejects %s', async (_case, defaultPauseHours) => {
      await expect(failedProperties({ defaultPauseHours })).resolves.toEqual(['defaultPauseHours']);
    });
  });
});
