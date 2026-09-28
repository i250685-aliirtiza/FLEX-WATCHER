export const AuthState = Object.freeze({ AUTHENTICATED: 'AUTHENTICATED', AUTH_LOST: 'AUTH_LOST', WAITING_FOR_MANUAL_LOGIN: 'WAITING_FOR_MANUAL_LOGIN', AUTH_RECOVERED: 'AUTH_RECOVERED' });

export class AuthStateMachine {
  constructor({ log = console.log } = {}) { this.state = AuthState.AUTHENTICATED; this.log = log; }
  lose(reason) {
    if (this.state === AuthState.AUTHENTICATED || this.state === AuthState.AUTH_RECOVERED) {
      this.state = AuthState.AUTH_LOST; this.log(`AUTH LOST | ${reason}`); this.state = AuthState.WAITING_FOR_MANUAL_LOGIN; this.log('RECOVERY MODE ENTERED | normal marks processing paused'); return true;
    }
    return false;
  }
  recover() {
    if (this.state === AuthState.WAITING_FOR_MANUAL_LOGIN || this.state === AuthState.AUTH_LOST) {
      this.state = AuthState.AUTH_RECOVERED; this.log('AUTH RECOVERED'); return true;
    }
    return false;
  }
  authenticated() { this.state = AuthState.AUTHENTICATED; }
  isWaiting() { return this.state === AuthState.WAITING_FOR_MANUAL_LOGIN; }
}
