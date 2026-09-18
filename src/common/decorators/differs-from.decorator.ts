import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

@ValidatorConstraint({ name: 'differsFrom', async: false })
class DiffersFromConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    const [otherProperty] = args.constraints as [string];
    return value !== (args.object as Record<string, unknown>)[otherProperty];
  }

  defaultMessage(args: ValidationArguments): string {
    const [otherProperty] = args.constraints as [string];
    return `${args.property} must be different from ${otherProperty}`;
  }
}

/**
 * Fails when the decorated property equals another property of the same
 * payload — e.g. "the new password must not be the current one".
 *
 * A cross-field rule like this belongs with the DTO rather than in a service:
 * it is input validation, so it should produce a 400 alongside every other
 * validation failure instead of a hand-rolled check in business logic.
 */
export function DiffersFrom(
  otherProperty: string,
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (target: object, propertyName: string | symbol): void => {
    registerDecorator({
      name: 'differsFrom',
      target: target.constructor,
      propertyName: String(propertyName),
      constraints: [otherProperty],
      options: validationOptions,
      validator: DiffersFromConstraint,
    });
  };
}
