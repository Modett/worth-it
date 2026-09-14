import { ExecutionContext, InternalServerErrorException } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from './current-user.decorator';
import { AuthenticatedUser } from '../types/authenticated-user.interface';

const USER_ID = '11111111-1111-4111-8111-111111111111';

/**
 * Param decorators are factories, so the only way to test the resolver is to
 * apply the decorator and pull the stored factory back out of the metadata —
 * the same thing Nest does when building the handler's arguments.
 */
@Controller('example')
class ExampleController {
  @Get()
  handler(@CurrentUser() _userId: string): void {}
}

type ParamFactory = (data: unknown, context: ExecutionContext) => string;

function resolveCurrentUser(user: AuthenticatedUser | undefined): string {
  const metadata = Reflect.getMetadata(ROUTE_ARGS_METADATA, ExampleController, 'handler') as Record<
    string,
    { factory: ParamFactory }
  >;

  const [{ factory }] = Object.values(metadata);
  const context = {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;

  return factory(undefined, context);
}

describe('@CurrentUser()', () => {
  it('returns the userId the guard attached to the request', () => {
    expect(resolveCurrentUser({ userId: USER_ID })).toBe(USER_ID);
  });

  it('fails loudly when used on a route the JWT guard never populated', () => {
    expect(() => resolveCurrentUser(undefined)).toThrow(InternalServerErrorException);
  });
});
