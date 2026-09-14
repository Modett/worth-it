import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AUTH_CONFIG } from './auth.config';

/**
 * A bcrypt hash of a throwaway value, used to spend the same CPU time when the
 * email is unknown as when it exists. Without it, login latency reveals
 * whether an address is registered.
 */
const DUMMY_HASH = bcrypt.hashSync('timing-equalisation-placeholder', AUTH_CONFIG.bcryptCost);

@Injectable()
export class PasswordService {
  hash(plaintext: string): Promise<string> {
    return bcrypt.hash(plaintext, AUTH_CONFIG.bcryptCost);
  }

  verify(plaintext: string, passwordHash: string): Promise<boolean> {
    return bcrypt.compare(plaintext, passwordHash);
  }

  /**
   * Runs a comparison that always fails, so the "no such user" branch of login
   * costs the same as a real verification.
   */
  async wasteComparison(plaintext: string): Promise<void> {
    await bcrypt.compare(plaintext, DUMMY_HASH);
  }
}
