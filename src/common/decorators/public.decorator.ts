import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a route as reachable without authentication. Every endpoint is
 * authenticated by default (.cursorrules §5); this is the explicit opt-out
 * that the JWT guard (auth module, build step 2) will honour.
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
