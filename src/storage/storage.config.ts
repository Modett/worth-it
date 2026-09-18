/**
 * Cloudflare R2 tunables that are not secrets. The endpoint, keys and bucket
 * come from the validated environment so a replica cannot silently point at
 * the wrong store.
 */
export const STORAGE_CONFIG = {
  version: 1,
  /** R2's S3-compatible API ignores regions; `auto` is what their docs use. */
  region: 'auto',
} as const;
