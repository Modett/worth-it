/**
 * Single versioned source of truth for auth tunables (.cursorrules §3 — no
 * magic numbers scattered through the codebase). Bump `version` whenever a
 * value changes so token-lifetime or hashing changes are traceable in git.
 *
 * These are deliberately code constants rather than environment variables:
 * every replica must agree on them, and a mistyped TTL in one Railway service
 * would silently weaken auth rather than fail loudly.
 */
export const AUTH_CONFIG = {
  version: 1,

  /** Short-lived so a leaked access token has a small blast radius. */
  accessTokenTtlSeconds: 15 * 60,

  /** Long-lived but single-use: every refresh rotates it (see AuthService). */
  refreshTokenTtlDays: 30,

  /**
   * 256 bits of entropy. Brute-forcing this is infeasible, which is why the
   * stored hash is plain SHA-256 rather than bcrypt.
   */
  refreshTokenBytes: 32,

  /** bcrypt cost factor — .cursorrules §5 requires >= 12. */
  bcryptCost: 12,

  /** DTO-level minimum; see SignupDto. */
  passwordMinLength: 8,

  /**
   * Signup and login are the brute-force surface, so they get a much tighter
   * per-IP budget than the global default (THROTTLE_LIMIT).
   */
  credentialThrottle: {
    limit: 5,
    ttlSeconds: 60,
  },
} as const;

export const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
