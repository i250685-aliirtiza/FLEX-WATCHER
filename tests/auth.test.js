import test from 'node:test';
import assert from 'node:assert/strict';
import { FlexAuthError, normalizeCookieInput, verifyAuthenticatedMarksResponse } from '../src/flex/auth.js';

const goodHtml = '<html><body><select id="SemId"><option selected value="20263">Fall 2026</option></select></body></html>';
const verify = overrides => verifyAuthenticatedMarksResponse({
  responseUrl: 'https://flexstudent.nu.edu.pk/Student/StudentMarks?semid=20263',
  status: 200,
  contentType: 'text/html; charset=utf-8',
  html: goodHtml,
  ...overrides,
});

function authFail(overrides, code) {
  assert.throws(() => verify(overrides), error => error instanceof FlexAuthError && error.code === code);
}

test('raw session id becomes ASP.NET_SessionId cookie', () => {
  assert.equal(normalizeCookieInput('abc123'), 'ASP.NET_SessionId=abc123');
});

test('full cookie header is accepted without modification', () => {
  assert.equal(normalizeCookieInput('ASP.NET_SessionId=abc; cf_clearance=xyz'), 'ASP.NET_SessionId=abc; cf_clearance=xyz');
  assert.equal(normalizeCookieInput('Cookie: ASP.NET_SessionId=abc'), 'ASP.NET_SessionId=abc');
});

test('authenticated marks route passes', () => {
  const proof = verify({});
  assert.equal(proof.path, '/Student/StudentMarks');
});

test('login redirects fail explicitly', () => {
  authFail({ responseUrl: 'https://flexstudent.nu.edu.pk/Account/Login' }, 'LOGIN_REQUIRED');
});

test('HTTP errors, foreign origins, and wrong routes fail', () => {
  authFail({ status: 500 }, 'HTTP_ERROR');
  authFail({ responseUrl: 'https://example.com/Student/StudentMarks' }, 'ROUTING_FAILED');
  authFail({ responseUrl: 'https://flexstudent.nu.edu.pk/Student/Dashboard' }, 'ROUTING_FAILED');
});

test('login-form HTML fails even on a 200 marks URL', () => {
  authFail({ html: '<form action="/Account/Login"><input type="password" name="Password"></form>' }, 'LOGIN_REQUIRED');
});

test('Cloudflare challenge HTML fails even on a 200 marks URL', () => {
  authFail({ html: '<html><title>Just a moment...</title><div id="cf-chl-widget"></div></html>' }, 'HUMAN_VERIFICATION_REQUIRED');
});

test('non-HTML and empty bodies fail closed', () => {
  authFail({ contentType: 'application/json' }, 'INVALID_CONTENT_TYPE');
  authFail({ html: '' }, 'INVALID_HTML');
});
