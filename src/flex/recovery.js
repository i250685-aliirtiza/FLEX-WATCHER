import { FlexAuthError } from './auth.js';

// Deliberately no guessed POST: the live page uses AJAX and Turnstile.
export async function loginToFlex() {
  throw new FlexAuthError('Automatic login needs a verified browser login capture (including Turnstile requirements). Restart with a valid cookie; see AUTHENTICATION.md.', 'MANUAL_INTERVENTION');
}

export class SessionRecovery {
  constructor({ login = loginToFlex, verify, now = Date.now, maxAttempts = 3, backoffMs = 60000, log = () => {} }) {
    this.login = login;
    this.verify = verify;
    this.now = now;
    this.maxAttempts = maxAttempts;
    this.backoffMs = backoffMs;
    this.log = log;
    this.attempts = 0;
    this.nextAttempt = 0;
    this.blocked = false;
  }

  async recover(error) {
    if (error?.code !== 'LOGIN_REQUIRED') throw error;
    if (this.blocked || this.attempts >= this.maxAttempts) {
      throw new FlexAuthError('Automatic recovery stopped. Manual intervention required; restart with a valid cookie.', 'MANUAL_INTERVENTION');
    }
    if (this.now() < this.nextAttempt) {
      throw new FlexAuthError('Automatic recovery is waiting for its retry backoff.', 'RECOVERY_BACKOFF');
    }
    this.attempts += 1;
    this.nextAttempt = this.now() + this.backoffMs * 2 ** (this.attempts - 1);
    try {
      const cookie = await this.login();
      const result = await this.verify(cookie);
      this.attempts = 0;
      this.nextAttempt = 0;
      this.log('SESSION RE-AUTHENTICATED | protected marks page verified');
      return { cookie, result };
    } catch (failure) {
      if (failure?.code === 'MANUAL_INTERVENTION' || this.attempts >= this.maxAttempts) {
        this.blocked = true;
        throw new FlexAuthError('Automatic login unavailable or retry limit reached. Manual intervention required; see AUTHENTICATION.md.', 'MANUAL_INTERVENTION');
      }
      // Do not expose provider responses or credential-bearing error messages.
      throw new FlexAuthError('Automatic recovery failed; retry scheduled with backoff.', 'RECOVERY_BACKOFF');
    }
  }
}
