/**
 * OpenStreetMap has not needed the a/b/c.tile.openstreetmap.org subdomains
 * since 2022 — tile.openstreetmap.org serves the whole grid on its own — and
 * d.tile.openstreetmap.org has meanwhile lost its DNS record entirely. A
 * template that still carries the `{s}` placeholder therefore depends on which
 * letters the renderer substitutes: everything that lands on `d` fails with
 * ERR_NAME_NOT_RESOLVED, which is console noise plus holes in the offline tile
 * cache (#1733).
 *
 * The presets ship the single-host form now, but a template the user (or an
 * admin default) saved earlier is still in the database. Rewriting it on read
 * fixes those instances without a migration; the settings store rewrites it on
 * save as well, so a legacy URL typed by hand converges on the same host
 * instead of coming back on the next load. Other providers are left untouched.
 */

/** `{s}.` or a bare shard letter in front of tile.openstreetmap.org. */
const OSM_SHARD = /^((?:https?:)?\/\/)(?:\{s\}|[a-d])\.tile\.openstreetmap\.org(?=[/:]|$)/i

/** Collapse a sharded OSM tile template onto the single supported host. */
export function normalizeTileUrl(url: string): string {
  if (!url) return url
  return url.replace(OSM_SHARD, '$1tile.openstreetmap.org')
}

/**
 * CARTO started watermarking keyless basemap tiles on 26.08.2026 (#2054). The
 * key rides along as a `?key=` query parameter, which every template engine in
 * the client passes through untouched, so it is appended here rather than baked
 * into the stored template: a saved URL stays portable and survives a key
 * change. Only CARTO hosts are touched; OSM and self-hosted templates are not.
 */
const CARTO_HOST = /^(?:\{s\}|[a-d])?\.?basemaps\.cartocdn\.com$/i

function templateHost(url: string): string {
  return url.replace(/^\w*:?\/\//, '').split(/[/?#]/)[0]
}

export function withTileApiKey(url: string, key?: string | null): string {
  if (!url || !key) return url
  if (!CARTO_HOST.test(templateHost(url))) return url
  if (/[?&]key=/.test(url)) return url
  return `${url}${url.includes('?') ? '&' : '?'}key=${encodeURIComponent(key)}`
}

/** Keeps the key out of anything we persist: stored templates, book documents. */
export function stripTileApiKey(url: string): string {
  if (!url) return url
  let next = url
  if (/[?&]key=/.test(next)) next = next.replace(/([?&])key=[^&]*&?/, '$1').replace(/[?&]$/, '')
  if (/[?&]tk=/.test(next)) next = next.replace(/([?&])tk=[^&]*&?/, '$1').replace(/[?&]$/, '')
  return next
}

/**
 * Same promise as CARTO: the tk is only appended when the *host* is Tianditu.
 * A path or query that merely mentions `tianditu.gov.cn` (or a look-alike like
 * `tianditu.gov.cn.evil.com`) must never receive the key.
 */
const TIANDITU_HOST = /^(?:t\{s\}|t[0-7])\.tianditu\.gov\.cn$/i

export function isTiandituTileUrl(url: string): boolean {
  if (!url) return false
  return TIANDITU_HOST.test(templateHost(url))
}

/** 天地图矢量底图配注记层（cva_w / cia_w）。 */
export function tiandituLabelUrl(url: string): string | null {
  if (!isTiandituTileUrl(url)) return null
  if (url.includes('T=vec_w')) return url.replace('T=vec_w', 'T=cva_w')
  if (url.includes('T=img_w')) return url.replace('T=img_w', 'T=cia_w')
  return null
}

export function withTiandituKey(url: string, key?: string | null): string {
  if (!url || !key || !isTiandituTileUrl(url)) return url
  if (/[?&]tk=/.test(url)) return url
  return `${url}${url.includes('?') ? '&' : '?'}tk=${encodeURIComponent(key)}`
}

/**
 * A blank template means "not configured", not "no tiles": the settings
 * previews save an empty string and would otherwise render grey.
 */
export function resolveTileUrl(
  template: string | null | undefined,
  fallback: string,
  cartoKey?: string | null,
  tiandituKey?: string | null,
): string {
  const normalized = normalizeTileUrl(template?.trim() || fallback)
  return withTiandituKey(withTileApiKey(normalized, cartoKey), tiandituKey)
}
