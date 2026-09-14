/**
 * The single error shape every API response uses (.cursorrules §3).
 * `message` is an array only for validation failures, where each entry is
 * one field-level problem.
 */
export interface ErrorResponse {
  statusCode: number;
  message: string | string[];
  error: string;
  timestamp: string;
  path: string;
}
