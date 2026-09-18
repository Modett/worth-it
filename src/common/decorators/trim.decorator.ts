import { Transform } from 'class-transformer';

/**
 * Strips surrounding whitespace before validation runs, so length rules judge
 * the text the user actually typed: `"   "` fails a one-character minimum
 * instead of passing it, and `" Nike "` is stored without its padding.
 *
 * Non-strings pass through untouched, leaving the type validator on the same
 * property to report the real problem rather than a length one.
 */
export function Trim(): PropertyDecorator {
  return Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  );
}
