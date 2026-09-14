/**
 * Claims carried by an access token. `sub` is the user id, per the JWT spec,
 * and is the only application claim — anything else would go stale for up to
 * the token's lifetime.
 */
export interface JwtPayload {
  sub: string;
}

/** A verified payload also carries the registered claims jsonwebtoken adds. */
export interface VerifiedJwtPayload extends JwtPayload {
  iat: number;
  exp: number;
}
