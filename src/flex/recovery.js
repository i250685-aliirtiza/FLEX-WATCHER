import { FlexAuthError } from './auth.js';

// Deliberately no guessed POST: the live page uses AJAX and Turnstile.
export async function loginToFlex({ browserType } = {}) {
  const username = process.env.FLEX_USERNAME;
  const password = process.env.FLEX_PASSWORD;
  if (!username || !password) throw new FlexAuthError('FLEX_USERNAME and FLEX_PASSWORD are required for automatic login.', 'MANUAL_INTERVENTION');
  let chromium;
  try { ({ chromium } = await import('playwright')); } catch {
    throw new FlexAuthError('Playwright is unavailable; install dependencies and retry.', 'MANUAL_INTERVENTION');
  }
  const browser = await (browserType || chromium).launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('https://flexstudent.nu.edu.pk/Login', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.locator('input[name="username"]').fill(username);
    await page.locator('input[name="password"]').fill(password);
    const challenge = page.locator('input[name="cf-turnstile-response"]');
    await challenge.waitFor({ state: 'attached', timeout: 30000 });
    await page.waitForFunction(() => Boolean(document.querySelector('input[name="cf-turnstile-response"]')?.value), null, { timeout: 120000 });
    await Promise.all([
      page.waitForResponse(response => response.url().toLowerCase().endsWith('/login/login') && response.request().method() === 'POST', { timeout: 30000 }),
      page.locator('#m_login_signin_submit').click(),
    ]);
    const cookies = await context.cookies('https://flexstudent.nu.edu.pk');
    const session = cookies.find(cookie => cookie.name === 'ASP.NET_SessionId' && cookie.value);
    if (!session) throw new FlexAuthError('Automatic login returned no FLEX session cookie.', 'MANUAL_INTERVENTION');
    return `ASP.NET_SessionId=${session.value}`;
  } catch (error) {
    if (error?.code === 'MANUAL_INTERVENTION') throw error;
    throw new FlexAuthError('Automatic FLEX login failed or Turnstile did not complete.', 'MANUAL_INTERVENTION');
  } finally { await browser.close(); }
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
