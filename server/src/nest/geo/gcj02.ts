/**
 * Server-side GCJ helpers. Conversion math lives in `@trek/shared` so the
 * client "Open in Amap" URI cannot drift from the search-time transform.
 */

export { outOfChina, wgs84ToGcj02, gcj02ToWgs84 } from '@trek/shared';
import { gcj02ToWgs84 } from '@trek/shared';

/** 高德 `location` 字段：`"lng,lat"`，空值经常是 `[]`。 */
export function parseAmapLocation(location: unknown): { lat: number; lng: number } | null {
  if (typeof location !== 'string') return null;
  const [lngRaw, latRaw] = location.split(',');
  const lat = Number.parseFloat(latRaw ?? '');
  const lng = Number.parseFloat(lngRaw ?? '');
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return gcj02ToWgs84(lat, lng);
}
