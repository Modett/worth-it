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

/**
 * Presence and format are checked by one constraint rather than by
 * `@ValidateIf()` plus `@IsUrl()`, because `@ValidateIf()` gates *every*
 * validator on a property: a condition that enables the URL format check for
 * LINK items would equally disable the "not allowed here" check for MANUAL
 * ones, leaving no rule at all in the case that needs one.
 */
function describeFailure(value: unknown, object: object): string | null {
  const { source } = object as { source?: unknown };

  if (source !== ItemSource.LINK) {
    // Also the branch taken when `source` is missing or invalid, which has its
    // own error; a stray URL alongside it is still worth reporting.
    return value === undefined || value === null
      ? null
      : `sourceUrl is only allowed when source is ${ItemSource.LINK}`;
  }

  if (value === undefined || value === null) {
    return `sourceUrl is required when source is ${ItemSource.LINK}`;
  }

  if (typeof value !== 'string') {
    return 'sourceUrl must be a string';
  }

  if (value.length > ITEMS_CONFIG.sourceUrl.maxLength) {
    return `sourceUrl must be at most ${ITEMS_CONFIG.sourceUrl.maxLength} characters`;
  }

  const protocols = [...ITEMS_CONFIG.sourceUrl.protocols];
  if (!isURL(value, { protocols, require_protocol: true })) {
    return `sourceUrl must be a valid ${protocols.join(' or ')} URL`;
  }

  return null;
}

@ValidatorConstraint({ name: 'sourceUrlMatchesSource', async: false })
class SourceUrlMatchesSourceConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    return describeFailure(value, args.object) === null;
  }

  defaultMessage(args: ValidationArguments): string {
    return describeFailure(args.value, args.object) ?? '';
  }
}

/**
 * Ties `sourceUrl` to the item's `source`: required and well-formed for a LINK
 * item, absent for any other source.
 */
export function SourceUrlMatchesSource(validationOptions?: ValidationOptions): PropertyDecorator {
  return (target: object, propertyName: string | symbol): void => {
    registerDecorator({
      name: 'sourceUrlMatchesSource',
      target: target.constructor,
      propertyName: String(propertyName),
      options: validationOptions,
      validator: SourceUrlMatchesSourceConstraint,
    });
  };
}
