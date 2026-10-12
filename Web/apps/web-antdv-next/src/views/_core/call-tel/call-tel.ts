export interface DialContact {
  name: string;
  number: string;
  href: string;
}

export function parseDialContact(code: unknown): DialContact | undefined {
  if (typeof code !== 'string' || !code || code.length > 8192) return;
  try {
    const text = code.trim().startsWith('{') ? code : decodeURIComponent(code);
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== 'object' || !('number' in value) || typeof value.number !== 'string') return;
    const number = value.number.trim();
    if (!/^\+?[\d\s()-]{3,32}$/u.test(number)) return;
    const digits = number.replace(/[^\d]/gu, '');
    if (digits.length < 3 || digits.length > 20) return;
    const name = 'realName' in value && typeof value.realName === 'string' ? value.realName.trim().slice(0, 128) : '';
    return { name, number, href: 'tel:' + number.replace(/[\s()-]/gu, '') };
  } catch {
    return;
  }
}
