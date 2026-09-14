import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY, Public } from './public.decorator';

describe('@Public()', () => {
  class ExampleController {
    @Public()
    openRoute(): void {}

    protectedRoute(): void {}
  }

  const reflector = new Reflector();

  it('flags decorated handlers as public', () => {
    expect(reflector.get<boolean>(IS_PUBLIC_KEY, ExampleController.prototype.openRoute)).toBe(true);
  });

  it('leaves undecorated handlers authenticated by default', () => {
    expect(
      reflector.get<boolean | undefined>(IS_PUBLIC_KEY, ExampleController.prototype.protectedRoute),
    ).toBeUndefined();
  });
});
