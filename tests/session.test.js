import test from 'node:test';
import assert from 'node:assert/strict';
import { FlexSession } from '../src/flex/session.js';
test('session jar preserves initial and rotated cookies', () => {
 const s = new FlexSession('ASP.NET_SessionId=abc; foo=bar');
 const headers = new Headers(); headers.append('set-cookie','ASP.NET_SessionId=def; Path=/'); headers.append('set-cookie','newcookie=yes; Path=/');
 s.acceptSetCookie(headers);
 assert.match(s.header(), /ASP.NET_SessionId=def/); assert.match(s.header(), /newcookie=yes/); assert.match(s.fingerprint(), /^[a-f0-9]{8}$/);
});
test('session jar handles combined Set-Cookie fallback and fingerprints without values', () => {
 const s = new FlexSession('ASP.NET_SessionId=abc');
 s.acceptSetCookie({ getSetCookie: undefined, get: () => 'foo=bar; Path=/, baz=qux; Path=/' });
 assert.equal(s.header(), 'ASP.NET_SessionId=abc; foo=bar; baz=qux');
 assert.equal(s.has('foo'), true);
 assert.match(s.fingerprint(), /^[a-f0-9]{8}$/);
 assert.doesNotMatch(s.fingerprint(), /abc|bar|qux/);
});
