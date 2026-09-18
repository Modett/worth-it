import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import { IsString, MinLength } from 'class-validator';
import { Trim } from './trim.decorator';

class Sample {
  @Trim()
  @IsString()
  @MinLength(1)
  name!: string;

  @Trim()
  untyped!: unknown;
}

function build(input: Record<string, unknown>): Sample {
  return plainToInstance(Sample, input);
}

describe('Trim', () => {
  it.each([
    ['leading whitespace', '  Nike', 'Nike'],
    ['trailing whitespace', 'Nike  ', 'Nike'],
    ['both ends', '\t Nike \n', 'Nike'],
    ['nothing to trim', 'Nike', 'Nike'],
  ])('removes %s', (_case, input, expected) => {
    expect(build({ name: input }).name).toBe(expected);
  });

  it('leaves whitespace inside the value alone', () => {
    expect(build({ name: '  Runner 2 Trail Shoes  ' }).name).toBe('Runner 2 Trail Shoes');
  });

  it('turns a whitespace-only value into one that fails a minimum length', async () => {
    const errors: ValidationError[] = await validate(build({ name: '   ' }));

    expect(errors.map((error) => error.property)).toEqual(['name']);
  });

  it.each([
    ['a number', 7],
    ['a boolean', true],
    ['null', null],
    ['undefined', undefined],
    ['an object', { brand: 'Nike' }],
  ])('passes %s through untouched, leaving the type rule to report it', (_case, value) => {
    expect(build({ untyped: value }).untyped).toEqual(value);
  });
});
