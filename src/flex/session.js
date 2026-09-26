import { createHash } from 'node:crypto';

export class FlexSession {
  constructor(cookieInput) {
    this.cookies = new Map();
    this.acceptCookieHeader(cookieInput);
  }

  acceptCookieHeader(header) {
    for (const part of String(header || '').split(';')) {
      const i = part.indexOf('=');
      if (i > 0) this.cookies.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
    }
  }

  acceptSetCookie(headers) {
    const values = typeof headers.getSetCookie === 'function'
      ? headers.getSetCookie()
      : (headers.get('set-cookie') ? headers.get('set-cookie').split(/,(?=[^;,=]+\s*=)/) : []);
    for (const value of values) {
      const first = value.split(';', 1)[0];
      const i = first.indexOf('=');
      if (i > 0) this.cookies.set(first.slice(0, i).trim(), first.slice(i + 1).trim());
    }
    return values.length > 0;
  }

  has(name) { return this.cookies.has(name); }

  header() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '); }
  fingerprint() { return createHash('sha256').update(this.header()).digest('hex').slice(0, 8); }
}
