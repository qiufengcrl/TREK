import { isAmapShareUrl } from '@trek/shared'

export { isAmapShareUrl }

export interface PlaceFormData {
  name: string
  description: string
  address: string
  lat: string
  lng: string
  category_id: string
  place_time: string
  end_time: string
  notes: string
  transport_mode: string
  website: string
  // Populated from a maps-search pick (not part of the initial blank form).
  phone?: string
  google_place_id?: string
  google_ftid?: string
  osm_id?: string
  // Hero image picked from the detail column. Optional and absent from
  // DEFAULT_FORM on purpose: the mobile sheet shares this type and never sets
  // it, and places.service already writes image_url through on create/update.
  image_url?: string
}

export function isShareMapUrl(input: string): boolean {
  return isGoogleMapsUrl(input) || isAmapShareUrl(input)
}

/** 分享卡片经常是「名称 + 地址 + 链接」。抽出第一条可解析的地图 URL。 */
export function extractShareMapUrl(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  if (isShareMapUrl(trimmed)) return trimmed
  const matches = trimmed.match(/https?:\/\/[^\s<>"']+/gi) || []
  for (const raw of matches) {
    const cleaned = raw.replace(/[),.;]+$/g, '')
    if (isShareMapUrl(cleaned)) return cleaned
  }
  return null
}

export function isGoogleMapsUrl(input: string): boolean {
  try {
    const { hostname, pathname } = new URL(input.trim())
    const h = hostname.toLowerCase()
    // maps.app.goo.gl, goo.gl/maps
    if (h === 'maps.app.goo.gl') return true
    if (h === 'goo.gl' && pathname.startsWith('/maps')) return true
    // maps.google.* (e.g. maps.google.com, maps.google.co.uk)
    // Must be maps.google.<tld> or maps.google.<sld>.<tld> — reject maps.google.evil.com
    if (/^maps\.google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(h)) return true
    // google.*/maps (e.g. google.com/maps, www.google.co.uk/maps)
    const bare = h.startsWith('www.') ? h.slice(4) : h
    if (/^google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(bare) && pathname.startsWith('/maps')) return true
    return false
  } catch {
    return false
  }
}

export const DEFAULT_FORM: PlaceFormData = {
  name: '',
  description: '',
  address: '',
  lat: '',
  lng: '',
  category_id: '',
  place_time: '',
  end_time: '',
  notes: '',
  transport_mode: 'walking',
  website: '',
}

/**
 * The fields a maps result owns. Everything else in the form belongs to the
 * user and is never touched by picking a place.
 */
export const RESULT_FIELDS = [
  'name',
  'address',
  'lat',
  'lng',
  'google_place_id',
  'google_ftid',
  'osm_id',
  'website',
  'phone',
] as const

export type ResultField = (typeof RESULT_FIELDS)[number]

/**
 * Folds a picked search result into the form.
 *
 * The obvious version is `result.x || prev.x`, and it has a bug that is easy to
 * miss and hard to spot as a user: that expression cannot tell "the user typed
 * this" from "the previous search result wrote this". Pick Hamburg Airport,
 * then pick Berlin Hauptbahnhof — which has no website in OpenStreetMap — and
 * the airport's website is still sitting in the field. Save it and the station
 * now links to an airport.
 *
 * So the caller tracks which fields it filled in itself. A field the last pick
 * wrote belongs to the last place and is cleared when the new one says nothing
 * about it; a field the user typed survives untouched. `autoFilled` is mutated
 * in place — it is the caller's record of what it owns.
 */
/** Details for a coord tip can come back with an empty name; keep the label the user picked. */
export function withFallbackName<T extends Record<string, unknown>>(place: T, fallback: string): T {
  const name = typeof place.name === 'string' ? place.name.trim() : ''
  return name ? place : { ...place, name: fallback }
}

/** First non-URL line of an App share card ("店名\\n地址\\nhttps://…"). */
export function extractShareCardName(input: string): string {
  for (const line of input.trim().split(/\r?\n/)) {
    const text = line.trim()
    if (text && !extractShareMapUrl(text)) return text
  }
  return ''
}

/**
 * Fold a resolveUrl payload into mergeResult so the previous pick's ids cannot
 * stick. Missing fields are `undefined` (not `""`): mergeResult still treats
 * them as empty and clears autofill, while mobile onPick does not write blanks
 * into the form.
 */
export function shareResolveToResult(
  resolved: { lat: number; lng: number; name?: string | null; address?: string | null; google_ftid?: string | null },
  fallbackName = '',
): Record<string, string | undefined> {
  return {
    name: resolved.name || fallbackName || undefined,
    address: resolved.address || undefined,
    lat: String(resolved.lat),
    lng: String(resolved.lng),
    google_ftid: resolved.google_ftid || undefined,
  }
}

export function mergeResult(
  prev: PlaceFormData,
  result: Record<string, unknown>,
  autoFilled: Set<ResultField>,
): PlaceFormData {
  const next = { ...prev } as PlaceFormData & Record<string, string | undefined>

  for (const field of RESULT_FIELDS) {
    const raw = result[field]
    const value = raw == null ? '' : String(raw)

    if (value) {
      next[field] = value
      autoFilled.add(field)
    } else if (autoFilled.has(field)) {
      // Belonged to the place that is no longer selected.
      next[field] = ''
      autoFilled.delete(field)
    }
    // Otherwise the user put it there; leave it alone.
  }

  return next
}
