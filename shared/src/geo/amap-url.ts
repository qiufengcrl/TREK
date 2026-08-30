/**
 * Host allow-list for Amap / Gaode share links.
 *
 * Used by the server (resolveUrl) and the client (paste detection). Keep this
 * the only copy — a lookalike like amap.com.evil.example must fail both sides.
 */
export function isAmapShareUrl(input: string): boolean {
  try {
    const host = new URL(input.trim()).hostname.toLowerCase();
    return host === 'amap.com' || host.endsWith('.amap.com') || host === 'gaode.com' || host.endsWith('.gaode.com');
  } catch {
    return false;
  }
}
