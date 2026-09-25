export class SessionAlertTracker {
  constructor({ sendAlert, log, logError } = {}) {
    this.alertSent = false;
    this.sendAlert = sendAlert;
    this.log = log || console.log;
    this.logError = logError || console.error;
  }

  isAlertSent() {
    return this.alertSent;
  }

  async onPollFailure(error) {
    if (error?.code !== 'LOGIN_REQUIRED') return false;
    if (this.alertSent) return false;

    if (typeof this.sendAlert !== 'function') {
      this.log('SESSION EXPIRED | Email alert disabled (no email config).');
      return false;
    }

    try {
      await this.sendAlert();
      this.alertSent = true;
      this.log('SESSION EXPIRY ALERT SENT');
      return true;
    } catch (err) {
      this.logError(`SESSION EXPIRY ALERT FAILED TO SEND: ${err.message}`);
      return false;
    }
  }

  onPollSuccess() {
    if (this.alertSent) {
      this.log('SESSION RE-AUTHENTICATED | Expiry alert state reset.');
    }
    this.alertSent = false;
  }
}
