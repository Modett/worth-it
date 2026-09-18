import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import { ItemStatus } from '../../../generated/prisma/client';
import { UpdateItemStatusDto } from './update-item-status.dto';

async function failedProperties(input: Record<string, unknown>): Promise<string[]> {
  const errors: ValidationError[] = await validate(plainToInstance(UpdateItemStatusDto, input));
  return errors.map((error) => error.property);
}

describe('UpdateItemStatusDto', () => {
  it.each([ItemStatus.PURCHASED, ItemStatus.SKIPPED, ItemStatus.RETURNED])(
    'accepts %s as something a client may ask for',
    async (status) => {
      await expect(failedProperties({ status })).resolves.toEqual([]);
    },
  );

  it('rejects PAUSED, which only the pauses module may set', async () => {
    await expect(failedProperties({ status: ItemStatus.PAUSED })).resolves.toEqual(['status']);
  });

  it('rejects WISHLIST, which is only ever the creation state', async () => {
    await expect(failedProperties({ status: ItemStatus.WISHLIST })).resolves.toEqual(['status']);
  });

  it.each([
    ['an unknown status', 'ARCHIVED'],
    ['lower case', 'purchased'],
    ['an empty string', ''],
    ['a number', 1],
    ['a missing status', undefined],
    ['an explicit null', null],
  ])('rejects %s', async (_case, status) => {
    await expect(failedProperties({ status })).resolves.toEqual(['status']);
  });
});
