import { ValidateIf } from 'class-validator';

/**
 * Marks a property as omittable without also accepting an explicit `null`.
 *
 * class-validator's `@IsOptional()` skips validation for `null` as well as for
 * `undefined`, which lets `{ "productName": null }` past every rule on the
 * property and on into a non-nullable column — turning a client mistake into a
 * database error rather than a 400. This skips only an absent key, so `null` is
 * still judged by the property's own validators.
 *
 * Use `@IsOptional()` instead where `null` is a meaningful value that clears a
 * nullable column.
 */
export function IsOptionalNotNull(): PropertyDecorator {
  return ValidateIf((_object: unknown, value: unknown) => value !== undefined);
}
