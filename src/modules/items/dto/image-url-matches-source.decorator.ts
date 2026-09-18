import {
  isURL,
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { ItemSource } from '../../../generated/prisma/client';
import { ITEMS_CONFIG } from '../items.config';

function describeFailure(value: unknown, object: object): string | null {
  const { source } = object as { source?: unknown };

  if (source !== ItemSource.SCREENSHOT) {
    return value === undefined || value === null
      ? null
      : `imageUrl is only allowed when source is ${ItemSource.SCREENSHOT}`;
  }

  if (value === undefined || value === null) {
    return `imageUrl is required when source is ${ItemSource.SCREENSHOT}`;
  }

  if (typeof value !== 'string') {
    return 'imageUrl must be a string';
  }

  if (value.length > ITEMS_CONFIG.imageUrl.maxLength) {
    return `imageUrl must be at most ${ITEMS_CONFIG.imageUrl.maxLength} characters`;
  }

  const protocols = [...ITEMS_CONFIG.imageUrl.protocols];
  if (!isURL(value, { protocols, require_protocol: true })) {
    return `imageUrl must be a valid ${protocols.join(' or ')} URL`;
  }

  return null;
}

@ValidatorConstraint({ name: 'imageUrlMatchesSource', async: false })
class ImageUrlMatchesSourceConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    return describeFailure(value, args.object) === null;
  }

  defaultMessage(args: ValidationArguments): string {
    return describeFailure(args.value, args.object) ?? '';
  }
}

/**
 * Ties `imageUrl` to the item's `source`: required and well-formed for a
 * SCREENSHOT item, absent for any other source. Mirrors SourceUrlMatchesSource
 * for LINK so the confirm-after-extraction path reuses POST /items.
 */
export function ImageUrlMatchesSource(validationOptions?: ValidationOptions): PropertyDecorator {
  return (target: object, propertyName: string | symbol): void => {
    registerDecorator({
      name: 'imageUrlMatchesSource',
      target: target.constructor,
      propertyName: String(propertyName),
      options: validationOptions,
      validator: ImageUrlMatchesSourceConstraint,
    });
  };
}
