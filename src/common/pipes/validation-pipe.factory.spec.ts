import { ArgumentMetadata, BadRequestException } from '@nestjs/common';
import { IsInt, IsString } from 'class-validator';
import { createValidationPipe } from './validation-pipe.factory';

class ExampleDto {
  @IsString()
  name!: string;

  @IsInt()
  quantity!: number;
}

const metadata: ArgumentMetadata = { type: 'body', metatype: ExampleDto, data: undefined };

describe('createValidationPipe', () => {
  const pipe = createValidationPipe();

  it('transforms valid payloads into DTO instances', async () => {
    const result: unknown = await pipe.transform({ name: 'Lamp', quantity: 2 }, metadata);

    expect(result).toBeInstanceOf(ExampleDto);
    expect(result).toEqual({ name: 'Lamp', quantity: 2 });
  });

  it('rejects payloads with unknown properties instead of silently stripping them', async () => {
    await expect(
      pipe.transform({ name: 'Lamp', quantity: 2, isAdmin: true }, metadata),
    ).rejects.toThrow(BadRequestException);
  });

  it('reports every failing field, not just the first', async () => {
    let caught: unknown;
    try {
      await pipe.transform({ name: 42, quantity: 'two' }, metadata);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(BadRequestException);
    const body = (caught as BadRequestException).getResponse() as { message: string[] };
    expect(body.message).toHaveLength(2);
  });

  it('does not implicitly coerce strings to numbers', async () => {
    await expect(pipe.transform({ name: 'Lamp', quantity: '2' }, metadata)).rejects.toThrow(
      BadRequestException,
    );
  });
});
