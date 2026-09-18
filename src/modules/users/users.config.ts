/**
 * Single versioned source of truth for the users module's tunables
 * (.cursorrules §3 — no magic numbers scattered through the codebase). Bump
 * `version` whenever a bound changes, so a widened limit is traceable in git.
 */
export const USERS_CONFIG = {
  version: 1,

  currency: {
    /**
     * ISO 4217 shape only: three uppercase letters. V1 deliberately does not
     * validate against a currency list — an unknown-but-well-formed code is a
     * display concern, not a reason to block onboarding.
     */
    pattern: /^[A-Z]{3}$/,
    length: 3,
  },

  monthlyBudget: {
    /**
     * The column is Decimal(12, 2), so two places is the finest granularity
     * that survives a round trip; anything smaller would be silently rounded.
     */
    decimalPlaces: 2,
    /** Effectively "> 0" at two decimal places. */
    min: 0.01,
    /** Not a real budget — a fat-fingered extra digit or a cents/units mix-up. */
    max: 10_000_000,
  },

  defaultPauseHours: {
    min: 1,
    /** One week. Longer than this is a wishlist, not a cooling-off pause. */
    max: 168,
  },

  /**
   * PATCH /users/me/password and DELETE /users/me both accept the account
   * password, which makes them a password-guessing surface for anyone holding
   * a stolen access token. They get the same tight per-IP budget as login
   * rather than the global default.
   */
  passwordConfirmationThrottle: {
    limit: 5,
    ttlSeconds: 60,
  },
} as const;
