const ITERATIONS = 100_000;
const enc = new TextEncoder();
const b64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf as ArrayBuffer)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return b64(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITERATIONS}$${b64(salt)}$${await derive(password, salt, ITERATIONS)}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  const [scheme, iterations, salt, hash] = (stored ?? '').split('$');
  if (scheme !== 'pbkdf2' || !iterations || !salt || !hash) return false;
  const actual = await derive(password, unb64(salt), Number(iterations));
  // Perbandingan waktu-konstan.
  let diff = actual.length ^ hash.length;
  for (let i = 0; i < Math.min(actual.length, hash.length); i++) diff |= actual.charCodeAt(i) ^ hash.charCodeAt(i);
  return diff === 0;
}

export function randomToken(bytes = 32): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function shortId(prefix: string): string {
  return `${prefix}-${randomToken(4).toUpperCase()}`;
}
