import { fromAmap, toAmap } from '@trek/shared'
import { isAmapTileUrl } from './tileUrl'

/** Leaflet latlng must be GCJ when the visible tiles are Amap (incl. satellite). */
export function usesGcjDisplay(
  tileUrl?: string | null,
  satellite = false,
  preferAmapSat = false,
): boolean {
  if (satellite) return preferAmapSat || isAmapTileUrl(tileUrl)
  return isAmapTileUrl(tileUrl)
}

export function toDisplayLatLng(lat: number, lng: number, gcjTiles: boolean): { lat: number; lng: number } {
  return gcjTiles ? toAmap(lat, lng) : { lat, lng }
}

export function fromDisplayLatLng(lat: number, lng: number, gcjTiles: boolean): { lat: number; lng: number } {
  return gcjTiles ? fromAmap(lat, lng) : { lat, lng }
}

export function shiftLatLng<T extends { lat?: number | null; lng?: number | null }>(item: T, gcjTiles: boolean): T {
  if (!gcjTiles || item.lat == null || item.lng == null) return item
  if (!Number.isFinite(item.lat) || !Number.isFinite(item.lng)) return item
  const c = toAmap(item.lat, item.lng)
  return { ...item, lat: c.lat, lng: c.lng }
}

export function shiftLine(line: [number, number][], gcjTiles: boolean): [number, number][] {
  if (!gcjTiles) return line
  return line.map(([lat, lng]) => {
    const c = toAmap(lat, lng)
    return [c.lat, c.lng]
  })
}
