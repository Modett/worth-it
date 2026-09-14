/**
 * What the JWT strategy attaches to the request once an access token has been
 * verified, and what `@CurrentUser()` reads. Lives in `common` so guards,
 * decorators and feature modules share one definition.
 */
export interface AuthenticatedUser {
  userId: string;
}

/** Express request once JwtAuthGuard has populated `user`. */
export interface RequestWithUser {
  user?: AuthenticatedUser;
}
