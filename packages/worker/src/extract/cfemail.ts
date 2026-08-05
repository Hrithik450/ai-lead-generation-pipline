/**
 * Cloudflare email obfuscation.
 *
 * Cloudflare's "Email Address Obfuscation" rewrites every mailto: on a page into
 * `<a href="/cdn-cgi/l/email-protection#<hex>">` plus `<span data-cfemail="<hex>">`.
 * The rendered page looks completely normal to a human, and both tier 0 and tier 1
 * find zero email addresses — a silent, total extraction failure on a very large
 * share of small-business sites. The encoding is a trivial XOR with the first byte.
 */

export function decodeCfEmail(hex: string): string | null {
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length < 4 || hex.length % 2 !== 0) return null;
  const key = Number.parseInt(hex.slice(0, 2), 16);
  let out = "";
  for (let i = 2; i < hex.length; i += 2) {
    const byte = Number.parseInt(hex.slice(i, i + 2), 16) ^ key;
    out += String.fromCharCode(byte);
  }
  // Guard against garbage: a successful decode is always a plausible address.
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(out) ? out : null;
}
