export class FlexAuthError extends Error {
  constructor(message, code = 'AUTH_FAILED') {
    super(message);
    this.name = 'FlexAuthError';
    this.code = code;
  }
}

function fail(message, code = 'AUTH_FAILED') {
  throw new FlexAuthError(message, code);
}

export function normalizeCookieInput(raw) {
  if (typeof raw !== 'string' || !raw.trim()) {
    fail('Missing FLEX_SESSION_ID/FLEX_COOKIE.', 'MISSING_COOKIE');
  }

  let value = raw.trim();
  if (/^cookie\s*:/i.test(value)) value = value.replace(/^cookie\s*:\s*/i, '');

  // Accept either the raw ASP.NET_SessionId value or an entire Cookie header.
  if (value.includes('=')) return value;
  return `ASP.NET_SessionId=${value}`;
}

/**
 * Proves that this response is the authenticated marks page, not merely HTTP 200.
 * The parser performs the second half of the proof by validating the marks DOM.
 */
export function verifyAuthenticatedMarksResponse({ responseUrl, status, contentType = '', html }) {
  if (typeof html !== 'string' || html.length === 0) {
    fail('FLEX returned an empty response body.', 'INVALID_HTML');
  }

  const lower = html.toLowerCase();
  const challengeSignals = [
    'cf-chl-',
    'challenge-platform',
    'verify you are human',
    'checking your browser',
    'just a moment...',
  ];
  if (challengeSignals.some(signal => lower.includes(signal))) {
    fail('Cloudflare/human verification page received instead of FLEX marks.', 'HUMAN_VERIFICATION_REQUIRED');
  }

  if (!Number.isInteger(status) || status < 200 || status >= 300) {
    fail(`FLEX returned HTTP ${status}.`, 'HTTP_ERROR');
  }

  let final;
  try {
    final = new globalThis.URL(responseUrl);
  } catch {
    fail(`Invalid final response URL: ${responseUrl}`, 'ROUTING_FAILED');
  }

  if (final.protocol !== 'https:' || final.hostname.toLowerCase() !== 'flexstudent.nu.edu.pk') {
    fail(`Redirected to unexpected origin ${final.origin}.`, 'ROUTING_FAILED');
  }

  const path = final.pathname.replace(/\/+$/, '').toLowerCase();
  if (path !== '/student/studentmarks') {
    if (path.includes('/login') || path.includes('/account/login')) {
      fail('FLEX session is no longer authenticated; request landed on the login page.', 'LOGIN_REQUIRED');
    }
    fail(`Expected /Student/StudentMarks but final path is ${final.pathname}.`, 'ROUTING_FAILED');
  }

  if (contentType && !contentType.toLowerCase().includes('text/html')) {
    fail(`Expected HTML but received Content-Type: ${contentType}.`, 'INVALID_CONTENT_TYPE');
  }

  const loginSignals = [
    /<input\b[^>]*\btype\s*=\s*["']?password\b/i,
    /<form\b[^>]*(?:action\s*=\s*["'][^"']*login|id\s*=\s*["'][^"']*login)/i,
    /\bname\s*=\s*["']password["']/i,
  ];
  if (loginSignals.some(re => re.test(html))) {
    fail('FLEX returned login-form markup instead of an authenticated marks page.', 'LOGIN_REQUIRED');
  }

  return {
    origin: final.origin,
    path: final.pathname,
  };
}
