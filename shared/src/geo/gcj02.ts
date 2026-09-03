/**
 * GCJ-02 (火星坐标) ↔ WGS-84 helpers.
 *
 * Policy: `places.lat/lng` and `collection_places.lat/lng` are stored as
 * **WGS-84** — the same frame as Google, Nominatim, OSRM, and OFM/OSM tiles.
 * Convert only at the Amap boundary (`toAmap` / `fromAmap`). Overseas points
 * are returned as-is. Client and server both import from here; do not
 * duplicate the math.
 */

const PI = Math.PI;
const A = 6378245.0;
const EE = 0.00669342162296594323;

export function outOfChina(lat: number, lng: number): boolean {
  if (lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271) return true;
  // The official rectangle also covers neighbours that are not GCJ. Keep
  // mainland cities (东兴 / 满洲里 / 丹东) inside; leave these pockets out.
  if (lat < 21.5 && lng > 102 && lng < 108.2) return true; // Vietnam / Laos
  if (lat > 45.2 && lng > 95 && lng < 116.5) return true; // Mongolia (乌兰巴托)
  if (lat > 41.2 && lng < 75.5) return true; // Kyrgyzstan (比什凯克)
  if (lat > 21.7 && lat < 25.4 && lng > 119.9 && lng < 122.1) return true; // Taiwan
  if (lat > 33 && lat < 40 && lng > 125.5) return true; // Korea
  return false;
}

function transformLat(x: number, y: number): number {
  let r = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  r += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0;
  r += ((20.0 * Math.sin(y * PI) + 40.0 * Math.sin((y / 3.0) * PI)) * 2.0) / 3.0;
  r += ((160.0 * Math.sin((y / 12.0) * PI) + 320.0 * Math.sin((y * PI) / 30.0)) * 2.0) / 3.0;
  return r;
}

function transformLng(x: number, y: number): number {
  let r = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  r += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0;
  r += ((20.0 * Math.sin(x * PI) + 40.0 * Math.sin((x / 3.0) * PI)) * 2.0) / 3.0;
  r += ((150.0 * Math.sin((x / 12.0) * PI) + 300.0 * Math.sin((x / 30.0) * PI)) * 2.0) / 3.0;
  return r;
}

function delta(lat: number, lng: number): { lat: number; lng: number } {
  const dLat = transformLat(lng - 105.0, lat - 35.0);
  const dLng = transformLng(lng - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * PI;
  const magic = 1 - EE * Math.sin(radLat) * Math.sin(radLat);
  const sqrtMagic = Math.sqrt(magic);
  return {
    lat: (dLat * 180.0) / (((A * (1 - EE)) / (magic * sqrtMagic)) * PI),
    lng: (dLng * 180.0) / ((A / sqrtMagic) * Math.cos(radLat) * PI),
  };
}

export function wgs84ToGcj02(lat: number, lng: number): { lat: number; lng: number } {
  if (outOfChina(lat, lng)) return { lat, lng };
  const d = delta(lat, lng);
  return { lat: lat + d.lat, lng: lng + d.lng };
}

/** Approximate inverse — good enough for Amap ↔ WGS at the API / tile boundary. */
export function gcj02ToWgs84(lat: number, lng: number): { lat: number; lng: number } {
  if (outOfChina(lat, lng)) return { lat, lng };
  const g = wgs84ToGcj02(lat, lng);
  return { lat: lat * 2 - g.lat, lng: lng * 2 - g.lng };
}

/** TREK storage / Google / OSM / OSRM → Amap Web API, share URIs, and Amap tiles. */
export function toAmap(lat: number, lng: number): { lat: number; lng: number } {
  return wgs84ToGcj02(lat, lng);
}

/** Amap Web API / share-link / tile click → TREK storage. */
export function fromAmap(lat: number, lng: number): { lat: number; lng: number } {
  return gcj02ToWgs84(lat, lng);
}
