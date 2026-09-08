// Utilitários mínimos de cookie. Evitamos um plugin só para duas credenciais HTTP.

export interface CookieOptions {
  readonly httpOnly?: boolean;
  readonly secure?: boolean;
  readonly sameSite?: 'Lax' | 'Strict' | 'None';
  readonly path?: string;
  readonly maxAgeSeconds?: number;
}

export function readCookie(header: string | undefined, name: string): string | null {
  if (header === undefined || header === '') return null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    if (key !== name) continue;
    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  }
  return null;
}

export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path ?? '/'}`);
  if (options.maxAgeSeconds !== undefined) parts.push(`Max-Age=${options.maxAgeSeconds}`);
  if (options.httpOnly ?? true) parts.push('HttpOnly');
  if (options.secure ?? false) parts.push('Secure');
  parts.push(`SameSite=${options.sameSite ?? 'Lax'}`);
  return parts.join('; ');
}

export function clearCookie(name: string, secure: boolean): string {
  return serializeCookie(name, '', { maxAgeSeconds: 0, secure });
}

export function clearCookieAtPath(name: string, secure: boolean, path: string): string {
  return serializeCookie(name, '', { maxAgeSeconds: 0, path, secure });
}
