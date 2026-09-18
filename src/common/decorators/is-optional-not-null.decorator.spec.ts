import { plainToInstance } from 'class-transformer';
import { IsOptional, IsString, validate, ValidationError } from 'class-validator';
import { IsOptionalNotNull } from './is-optional-not-null.decorator';

class Sample {
  @IsOptionalNotNull()
  @IsString()
  required?: string;

  @IsOptional()
  @IsString()
  nullable?: string | null;
}

async function failedProperties(input: Record<string, unknown>): Promise<string[]> {
  const errors: ValidationError[] = await validate(plainToInstance(Sample, input));
  return errors.map((error) => error.property);
}

describe('IsOptionalNotNull', () => {
  it('skips an absent property, exactly as @IsOptional() would', async () => {
    await expect(failedProperties({})).resolves.toEqual([]);
  });

  it('still validates a property that is present', async () => {
    await expect(failedProperties({ required: 'a value' })).resolves.toEqual([]);
    await expect(failedProperties({ required: 7 })).resolves.toEqual(['required']);
  });

  it('rejects an explicit null instead of waving it through to the database', async () => {
    await expect(failedProperties({ required: null })).resolves.toEqual(['required']);
  });

  it('differs from @IsOptional(), which lets the same null past every rule', async () => {
    // The contrast is the whole reason this decorator exists: `nullable` accepts
    // the null that `required` rejects.
    await expect(failedProperties({ nullable: null })).resolves.toEqual([]);
  });
});
