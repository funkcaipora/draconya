import { describe, expect, it } from 'vitest';
import { clearCookieAtPath, readCookie, serializeCookie } from './cookies.js';

describe('auth cookies', () => {
  it('round trips encoded values and ignores malformed unrelated cookies', () => {
    const serialized = serializeCookie('session', 'a b/c');
    expect(readCookie(`broken=%E0%A4%A; ${serialized}`, 'session')).toBe('a b/c');
  });

  it('sets the security attributes used by production session cookies', () => {
    expect(serializeCookie('session', 'token', {
      maxAgeSeconds: 60,
      secure: true,
    })).toBe('session=token; Path=/; Max-Age=60; HttpOnly; Secure; SameSite=Lax');
  });

  it('clears a cookie using the same restricted path', () => {
    expect(clearCookieAtPath('state', true, '/callback')).toBe(
      'state=; Path=/callback; Max-Age=0; HttpOnly; Secure; SameSite=Lax',
    );
  });
});
