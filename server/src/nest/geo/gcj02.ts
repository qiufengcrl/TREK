/**
 * Server-side GCJ helpers. Conversion math lives in `@trek/shared`.
 *
 * Stock places are WGS-84. Convert at the Amap boundary with `toAmap` /
 * `fromAmap`. `parseAmapLocation` only splits the `lng,lat` string — it does
 * not change the frame.
 */

export { outOfChina, wgs84ToGcj02, gcj02ToWgs84, toAmap, fromAmap } from '@trek/shared';

/** 高德 `location` 字段：`"lng,lat"`（GCJ-02），空值经常是 `[]`。只解析，不转 WGS。 */
export function parseAmapLocation(location: unknown): { lat: number; lng: number } | null {
  if (typeof location !== 'string') return null;
  const [lngRaw, latRaw] = location.split(',');
  const lat = Number.parseFloat(latRaw ?? '');
  const lng = Number.parseFloat(lngRaw ?? '');
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}
