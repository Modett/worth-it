import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import { ComputeScoreDto } from './compute-score.dto';

async function failedProperties(payload: Record<string, unknown>): Promise<string[]> {
  const errors: ValidationError[] = await validate(plainToInstance(ComputeScoreDto, payload));
  return errors.map((error) => error.property).sort();
}

describe('ComputeScoreDto', () => {
  it.each([true, false])('accepts similarOwned: %s', async (similarOwned) => {
    await expect(failedProperties({ similarOwned })).resolves.toEqual([]);
  });

  it.each([
    ['a missing flag', {}],
    ['a numeric 1', { similarOwned: 1 }],
    ['a numeric 0', { similarOwned: 0 }],
    ['a string true', { similarOwned: 'true' }],
    ['null', { similarOwned: null }],
  ])('rejects %s', async (_case, payload) => {
    await expect(failedProperties(payload)).resolves.toEqual(['similarOwned']);
  });
});
