/** "+971501234567" -> "+97150*****67". Enough to tell two numbers apart in a log, not to dial one. */
export function maskPhone(phone: string): string {
  const p = phone.trim();
  if (p.length <= 6) return '*'.repeat(p.length);
  return `${p.slice(0, 6)}${'*'.repeat(Math.max(p.length - 8, 1))}${p.slice(-2)}`;
}
