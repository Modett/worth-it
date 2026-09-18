import { validate } from 'class-validator';
import { DiffersFrom } from './differs-from.decorator';

class Payload {
  original!: string;

  @DiffersFrom('original')
  replacement!: string;
}

async function failedConstraints(payload: Partial<Payload>): Promise<Record<string, string>[]> {
  const instance = Object.assign(new Payload(), payload);
  const errors = await validate(instance, { skipMissingProperties: true });
  return errors.map((error) => error.constraints ?? {});
}

describe('DiffersFrom', () => {
  it('passes when the two properties differ', async () => {
    await expect(failedConstraints({ original: 'a', replacement: 'b' })).resolves.toEqual([]);
  });

  it('fails when the two properties are equal', async () => {
    await expect(failedConstraints({ original: 'a', replacement: 'a' })).resolves.toEqual([
      { differsFrom: 'replacement must be different from original' },
    ]);
  });

  it('is case sensitive, so a case-only change counts as different', async () => {
    await expect(failedConstraints({ original: 'a', replacement: 'A' })).resolves.toEqual([]);
  });

  it("leaves an absent counterpart to that property's own validators", async () => {
    await expect(failedConstraints({ replacement: 'b' })).resolves.toEqual([]);
  });
});
