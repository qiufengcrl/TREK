/**
 * 高德 Web 服务（国内地点搜索）。
 *
 * 固定打 restapi.amap.com，和 Nominatim 客户端一样：超时、识别 UA、
 * 把上游空数组收成空字符串。库存是 WGS-84：请求前 `toAmap`，响应后 `fromAmap`。
 */

import { isAmapShareUrl } from '@trek/shared';
import { UA } from '../maps/maps.helpers';
import { readCappedJson } from '../../utils/cappedFetch';
import { fromAmap, parseAmapLocation, toAmap } from './gcj02';

export { isAmapShareUrl };

/** Amap JSON payloads are a few POIs; a megabyte means the provider misbehaved. */
const MAX_AMAP_BYTES = 512 * 1024;

const BASE = 'https://restapi.amap.com';
const TIMEOUT_MS = 8000;
const MIN_INTERVAL_MS = 200;

let lastCall = 0;
let minIntervalMs = MIN_INTERVAL_MS;

/** Test seam — mirrors nominatim.client. Suite setup zeros this. */
export function setAmapThrottleInterval(ms: number): void {
  minIntervalMs = ms;
}

async function throttle(): Promise<void> {
  const elapsed = Date.now() - lastCall;
  const wait = minIntervalMs - elapsed;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
}

export interface AmapLocationBias {
  lat: number;
  lng: number;
}

export const AMAP_PLACE_PREFIX = 'amap:';

export function isAmapPlaceId(placeId: string): boolean {
  return placeId.startsWith(AMAP_PLACE_PREFIX);
}

export function amapPoiId(placeId: string): string {
  return placeId.slice(AMAP_PLACE_PREFIX.length);
}

/** 高德空字段经常是 `[]`，不是 `""`。 */
export function amapText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export interface AmapMappedPlace {
  google_place_id: null;
  google_ftid: null;
  osm_id: string | null;
  amap_id: string | null;
  name: string;
  address: string;
  lat: number | null;
  lng: number | null;
  rating: number | null;
  website: string | null;
  phone: string | null;
  opening_hours: string | null;
  image_url: string | null;
  types: string[];
  source: 'amap';
}

interface AmapEnvelope {
  status?: string;
  info?: string;
  infocode?: string;
  pois?: AmapPoi[];
  tips?: AmapTip[];
  regeocode?: {
    formatted_address?: unknown;
    addressComponent?: {
      building?: { name?: unknown };
      adcode?: unknown;
      city?: unknown;
    };
  };
  route?: { paths?: AmapPath[] };
  lives?: {
    city?: unknown;
    weather?: unknown;
    temperature?: unknown;
  }[];
  forecasts?: {
    casts?: {
      date?: unknown;
      dayweather?: unknown;
      nightweather?: unknown;
      daytemp?: unknown;
      nighttemp?: unknown;
    }[];
  }[];
}

interface AmapPath {
  distance?: unknown;
  /** v5: duration lives under cost when show_fields includes cost. */
  cost?: { duration?: unknown };
  steps?: AmapStep[];
}

interface AmapStep {
  polyline?: unknown;
  step_distance?: unknown;
  distance?: unknown;
  cost?: { duration?: unknown };
  duration?: unknown;
}

interface AmapPoi {
  id?: unknown;
  name?: unknown;
  address?: unknown;
  location?: unknown;
  tel?: unknown;
  type?: unknown;
  website?: unknown;
  biz_ext?: { rating?: unknown; open_time?: unknown; tel?: unknown };
  photos?: { url?: unknown }[];
}

interface AmapTip {
  id?: unknown;
  name?: unknown;
  district?: unknown;
  address?: unknown;
  location?: unknown;
}

export class AmapApiError extends Error {
  status: number;
  infocode?: string;
  constructor(message: string, status = 502, infocode?: string) {
    super(message);
    this.status = status;
    this.infocode = infocode;
  }
}

function applyLocationBias(params: URLSearchParams, bias?: AmapLocationBias): void {
  if (!bias || !Number.isFinite(bias.lat) || !Number.isFinite(bias.lng)) return;
  const gcj = toAmap(bias.lat, bias.lng);
  params.set('location', `${gcj.lng},${gcj.lat}`);
}

async function amapFetch(path: string, params: URLSearchParams, signal?: AbortSignal): Promise<AmapEnvelope> {
  await throttle();
  if (signal?.aborted) throw new AmapApiError('Amap request aborted', 499);
  const url = `${BASE}${path}?${params.toString()}`;
  // Per-call timeout plus an optional caller abort (client disconnect mid multi-leg route).
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { 'User-Agent': UA },
      signal: combined,
    });
  } catch (err) {
    if (signal?.aborted || (err instanceof Error && err.name === 'AbortError')) {
      throw new AmapApiError('Amap request aborted', 499);
    }
    const message = err instanceof Error ? err.message : 'Amap request failed';
    throw new AmapApiError(`Amap request failed: ${message}`, 502);
  }
  if (!response.ok) {
    throw new AmapApiError(`Amap API error: ${response.status} ${response.statusText}`, response.status);
  }
  const data = await readCappedJson<AmapEnvelope>(response, MAX_AMAP_BYTES);
  if (!data || typeof data !== 'object') {
    throw new AmapApiError('Amap API error', 502);
  }
  if (data.status !== '1') {
    const info = amapText(data.info) || 'Amap API error';
    const invalidKey = data.infocode === '10001' || data.infocode === '10004';
    throw new AmapApiError(info, invalidKey ? 403 : 502, data.infocode);
  }
  return data;
}

function mapPoi(poi: AmapPoi): AmapMappedPlace {
  const raw = parseAmapLocation(poi.location);
  const coords = raw ? fromAmap(raw.lat, raw.lng) : null;
  const id = amapText(poi.id);
  const address = amapText(poi.address);
  const types = amapText(poi.type)
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  const ratingRaw = amapText(poi.biz_ext?.rating);
  const rating = ratingRaw ? Number.parseFloat(ratingRaw) : NaN;
  const photoUrl = amapText(poi.photos?.[0]?.url) || null;
  const prefixed = id ? `${AMAP_PLACE_PREFIX}${id}` : null;
  return {
    google_place_id: null,
    google_ftid: null,
    // osm_id is the persisted provider id the place form already saves. Prefix
    // keeps getPlaceDetails on the Amap branch (checked before OSM colon split).
    osm_id: prefixed,
    amap_id: prefixed,
    name: amapText(poi.name),
    address,
    lat: coords?.lat ?? null,
    lng: coords?.lng ?? null,
    rating: Number.isFinite(rating) ? rating : null,
    website: amapText(poi.website) || null,
    phone: amapText(poi.tel) || amapText(poi.biz_ext?.tel) || null,
    opening_hours: amapText(poi.biz_ext?.open_time) || null,
    image_url: photoUrl,
    types,
    source: 'amap',
  };
}

export async function searchAmap(
  key: string,
  query: string,
  bias?: AmapLocationBias,
): Promise<AmapMappedPlace[]> {
  const params = new URLSearchParams({
    key,
    keywords: query,
    offset: '10',
    page: '1',
    extensions: 'all',
  });
  applyLocationBias(params, bias);
  const data = await amapFetch('/v3/place/text', params);
  return (Array.isArray(data.pois) ? data.pois : []).map(mapPoi);
}

export async function autocompleteAmap(
  key: string,
  input: string,
  bias?: AmapLocationBias,
): Promise<{ suggestions: { placeId: string; mainText: string; secondaryText: string }[]; source: string }> {
  const params = new URLSearchParams({
    key,
    keywords: input,
  });
  applyLocationBias(params, bias);
  const data = await amapFetch('/v3/assistant/inputtips', params);
  const suggestions = (Array.isArray(data.tips) ? data.tips : [])
    .map((tip) => {
      const id = amapText(tip.id);
      const name = amapText(tip.name);
      const secondary = [amapText(tip.district), amapText(tip.address)].filter(Boolean).join(' ');
      if (!name) return null;
      // 没有 POI id 时用坐标占位，并把建议名编进 id，详情空名时还能还原。
      const coords = parseAmapLocation(tip.location);
      const placeId = id
        ? `${AMAP_PLACE_PREFIX}${id}`
        : coords
          ? `${AMAP_PLACE_PREFIX}coord:${coords.lng.toFixed(6)},${coords.lat.toFixed(6)}:${encodeURIComponent(name)}`
          : '';
      if (!placeId) return null;
      return { placeId, mainText: name, secondaryText: secondary };
    })
    .filter((s): s is { placeId: string; mainText: string; secondaryText: string } => !!s)
    .slice(0, 5);
  return { suggestions, source: 'amap' };
}

export async function detailsAmap(key: string, placeId: string): Promise<AmapMappedPlace | null> {
  const rest = amapPoiId(placeId);
  if (rest.startsWith('coord:')) {
    const raw = rest.slice('coord:'.length);
    const colon = raw.indexOf(':');
    const coordsPart = colon === -1 ? raw : raw.slice(0, colon);
    const namePart = colon === -1 ? '' : raw.slice(colon + 1);
    const [lngRaw, latRaw] = coordsPart.split(',');
    const lat = Number.parseFloat(latRaw ?? '');
    const lng = Number.parseFloat(lngRaw ?? '');
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const wgs = fromAmap(lat, lng);
    let name = '';
    try {
      name = namePart ? decodeURIComponent(namePart) : '';
    } catch {
      name = namePart;
    }
    return {
      google_place_id: null,
      google_ftid: null,
      osm_id: placeId,
      amap_id: placeId,
      name,
      address: '',
      lat: wgs.lat,
      lng: wgs.lng,
      rating: null,
      website: null,
      phone: null,
      opening_hours: null,
      image_url: null,
      types: [],
      source: 'amap',
    };
  }
  if (!rest) return null;
  const params = new URLSearchParams({ key, id: rest, extensions: 'all' });
  const data = await amapFetch('/v3/place/detail', params);
  const poi = Array.isArray(data.pois) ? data.pois[0] : undefined;
  return poi ? mapPoi(poi) : null;
}

/**
 * Explore-pill categories → Amap POI typecodes (Web 服务「周边搜索」).
 * Keys must stay in lockstep with CATEGORY_OSM_FILTERS / client POI_CATEGORIES.
 */
export const CATEGORY_AMAP_TYPECODES: Record<string, string> = {
  restaurant: '050000',
  cafe: '050500',
  bar: '050200|080300',
  hotel: '100000',
  sights: '110000',
  museum: '140000',
  nature: '110101|110102',
  activity: '080600|110200',
  shopping: '060100|060101',
  supermarket: '060200',
};

/**
 * Around-search for the map explore pill. `location` is WGS-84 (stock CRS).
 * Radius is metres; Amap caps at 50 km.
 */
export async function aroundAmap(
  key: string,
  types: string,
  location: AmapLocationBias,
  opts?: { radius?: number; limit?: number },
): Promise<AmapMappedPlace[]> {
  const radius = Math.min(Math.max(opts?.radius ?? 3000, 100), 50000);
  const limit = Math.min(Math.max(opts?.limit ?? 60, 1), 50);
  const gcj = toAmap(location.lat, location.lng);
  const params = new URLSearchParams({
    key,
    location: `${gcj.lng},${gcj.lat}`,
    types,
    radius: String(radius),
    offset: String(limit),
    page: '1',
    extensions: 'all',
  });
  const data = await amapFetch('/v3/place/around', params);
  return (Array.isArray(data.pois) ? data.pois : []).map(mapPoi);
}

/**
 * Live / forecast weather for a WGS-84 point. Resolves city adcode via regeo,
 * then hits weatherInfo. Returns null when Amap has no forecast for the city.
 */
export async function weatherAmap(
  key: string,
  lat: number,
  lng: number,
  extensions: 'base' | 'all' = 'base',
): Promise<{
  city: string;
  adcode: string;
  weather: string;
  temperature: string;
  forecasts: { date: string; dayweather: string; nightweather: string; daytemp: string; nighttemp: string }[];
} | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const gcj = toAmap(lat, lng);
  const regeoParams = new URLSearchParams({
    key,
    location: `${gcj.lng},${gcj.lat}`,
    extensions: 'base',
  });
  const regeo = await amapFetch('/v3/geocode/regeo', regeoParams);
  const adcode = amapText(regeo.regeocode?.addressComponent?.adcode);
  if (!adcode) return null;
  const weatherParams = new URLSearchParams({ key, city: adcode, extensions });
  const data = await amapFetch('/v3/weather/weatherInfo', weatherParams);
  const live = Array.isArray(data.lives) ? data.lives[0] : undefined;
  const forecasts = (Array.isArray(data.forecasts) ? data.forecasts : []).flatMap((f) =>
    (Array.isArray(f.casts) ? f.casts : []).map((c) => ({
      date: amapText(c.date),
      dayweather: amapText(c.dayweather),
      nightweather: amapText(c.nightweather),
      daytemp: amapText(c.daytemp),
      nighttemp: amapText(c.nighttemp),
    })),
  );
  return {
    city: amapText(live?.city) || amapText(regeo.regeocode?.addressComponent?.city) || adcode,
    adcode,
    weather: amapText(live?.weather),
    temperature: amapText(live?.temperature),
    forecasts,
  };
}

export async function reverseAmap(
  key: string,
  lat: string,
  lng: string,
): Promise<{ name: string | null; address: string | null }> {
  const wgsLat = Number.parseFloat(lat);
  const wgsLng = Number.parseFloat(lng);
  if (!Number.isFinite(wgsLat) || !Number.isFinite(wgsLng)) return { name: null, address: null };
  const gcj = toAmap(wgsLat, wgsLng);
  const params = new URLSearchParams({
    key,
    location: `${gcj.lng},${gcj.lat}`,
    extensions: 'base',
  });
  const data = await amapFetch('/v3/geocode/regeo', params);
  const address = amapText(data.regeocode?.formatted_address) || null;
  const name = amapText(data.regeocode?.addressComponent?.building?.name) || null;
  return { name, address };
}

export async function probeAmapKey(key: string): Promise<boolean> {
  try {
    await searchAmap(key, '北京');
    return true;
  } catch {
    return false;
  }
}

export type AmapRouteProfile = 'driving' | 'walking' | 'cycling';

export interface AmapRouteLeg {
  distance: number;
  duration: number;
}

/** WGS-84 geometry in `[lat, lng]` — same CRS/order as stock places + RouteWithLegs. */
export interface AmapRouteResult {
  coordinates: [number, number][];
  distance: number;
  duration: number;
  legs: AmapRouteLeg[];
}

const ROUTE_PATH: Record<AmapRouteProfile, string> = {
  driving: '/v5/direction/driving',
  walking: '/v5/direction/walking',
  cycling: '/v5/direction/bicycling',
};

function amapNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const n = Number.parseFloat(value);
    if (Number.isFinite(n)) return n;
  }
  return NaN;
}

function formatAmapLngLat(lat: number, lng: number): string {
  return `${lng.toFixed(6)},${lat.toFixed(6)}`;
}

/** Polyline is GCJ `lng,lat;lng,lat;…` — raw parse, still GCJ `[lat, lng]`. */
export function parseAmapPolyline(polyline: unknown): [number, number][] {
  if (typeof polyline !== 'string' || !polyline.trim()) return [];
  const out: [number, number][] = [];
  for (const part of polyline.split(';')) {
    const coords = parseAmapLocation(part.trim());
    if (coords) out.push([coords.lat, coords.lng]);
  }
  return out;
}

function pathFromAmap(path: AmapPath): { coordinates: [number, number][]; distance: number; duration: number } | null {
  const distance = amapNumber(path.distance);
  const duration = amapNumber(path.cost?.duration);
  if (!Number.isFinite(distance) || distance < 0 || !Number.isFinite(duration) || duration < 0) return null;
  const coordinates: [number, number][] = [];
  for (const step of Array.isArray(path.steps) ? path.steps : []) {
    for (const pt of parseAmapPolyline(step.polyline)) {
      const wgs = fromAmap(pt[0], pt[1]);
      const mapped: [number, number] = [wgs.lat, wgs.lng];
      const prev = coordinates[coordinates.length - 1];
      if (prev && prev[0] === mapped[0] && prev[1] === mapped[1]) continue;
      coordinates.push(mapped);
    }
  }
  if (coordinates.length < 2) return null;
  return { coordinates, distance, duration };
}

async function routeLegAmap(
  key: string,
  profile: AmapRouteProfile,
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  signal?: AbortSignal,
): Promise<{ coordinates: [number, number][]; distance: number; duration: number }> {
  const origin = toAmap(from.lat, from.lng);
  const dest = toAmap(to.lat, to.lng);
  const params = new URLSearchParams({
    key,
    origin: formatAmapLngLat(origin.lat, origin.lng),
    destination: formatAmapLngLat(dest.lat, dest.lng),
    // cost → duration; polyline → step geometry for the map blue line.
    show_fields: 'cost,polyline',
  });
  const data = await amapFetch(ROUTE_PATH[profile], params, signal);
  const path = Array.isArray(data.route?.paths) ? data.route?.paths[0] : undefined;
  if (!path) throw new AmapApiError('No route found', 502);
  const parsed = pathFromAmap(path);
  if (!parsed) throw new AmapApiError('No route found', 502);
  return parsed;
}

/** Vertex budget for the returned geometry — mirrors plugin-routes MAX_COORDINATES. */
const MAX_ROUTE_COORDINATES = 10_000;

/**
 * Route consecutive WGS-84 waypoints via Amap direction v5.
 *
 * One outbound call per leg (walking/cycling have no waypoints param; driving
 * could batch, but pairwise keeps per-leg distance/duration exact for the
 * sidebar connectors). Converts WGS→GCJ on the way in and GCJ→WGS on the way
 * out. Pass `signal` so a disconnected client stops burning further Amap quota.
 */
export async function routeAmap(
  key: string,
  profile: AmapRouteProfile,
  waypoints: { lat: number; lng: number }[],
  signal?: AbortSignal,
): Promise<AmapRouteResult> {
  if (waypoints.length < 2) {
    throw new AmapApiError('At least 2 waypoints required', 400);
  }
  for (const wp of waypoints) {
    if (!Number.isFinite(wp.lat) || !Number.isFinite(wp.lng)) {
      throw new AmapApiError('Invalid waypoint coordinates', 400);
    }
    if (wp.lat < -90 || wp.lat > 90 || wp.lng < -180 || wp.lng > 180) {
      throw new AmapApiError('Invalid waypoint coordinates', 400);
    }
  }

  const coordinates: [number, number][] = [];
  const legs: AmapRouteLeg[] = [];
  let distance = 0;
  let duration = 0;

  for (let i = 0; i < waypoints.length - 1; i++) {
    if (signal?.aborted) throw new AmapApiError('Amap request aborted', 499);
    const leg = await routeLegAmap(key, profile, waypoints[i]!, waypoints[i + 1]!, signal);
    for (const pt of leg.coordinates) {
      const prev = coordinates[coordinates.length - 1];
      if (prev && prev[0] === pt[0] && prev[1] === pt[1]) continue;
      coordinates.push(pt);
      if (coordinates.length > MAX_ROUTE_COORDINATES) {
        throw new AmapApiError('Route geometry too large', 502);
      }
    }
    legs.push({ distance: leg.distance, duration: leg.duration });
    distance += leg.distance;
    duration += leg.duration;
  }

  if (coordinates.length < 2 || legs.length !== waypoints.length - 1) {
    throw new AmapApiError('No route found', 502);
  }
  return { coordinates, distance, duration, legs };
}

/**
 * App 分享短链落地页：`?p=poiid,lat,lng,name,address`。
 * 坐标是 GCJ-02（纬度在前，和 `position=lng,lat` 相反）。调用方再 `fromAmap`。
 */
export function parseAmapShareP(url: string): {
  poiId: string | null;
  coords: { lat: number; lng: number } | null;
  name: string | null;
  address: string | null;
} {
  const empty = { poiId: null, coords: null, name: null, address: null };
  try {
    const raw = new URL(url).searchParams.get('p');
    if (!raw) return empty;
    const parts = raw.split(',');
    const poiId = parts[0] && /^[A-Za-z0-9]+$/.test(parts[0]) ? parts[0] : null;
    const lat = Number.parseFloat(parts[1] ?? '');
    const lng = Number.parseFloat(parts[2] ?? '');
    const coords = Number.isFinite(lat) && Number.isFinite(lng)
      ? parseAmapLocation(`${lng},${lat}`)
      : null;
    const name = parts[3]?.trim() || null;
    const address = parts.length > 4 ? parts.slice(4).join(',').trim() || null : null;
    return { poiId, coords, name, address };
  } catch {
    return empty;
  }
}

export function extractAmapPoiId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const fromQuery = parsed.searchParams.get('poiid') || parsed.searchParams.get('id');
    if (fromQuery && /^[A-Za-z0-9]+$/.test(fromQuery)) return fromQuery;
    const fromPath = parsed.pathname.match(/\/place\/([A-Za-z0-9]+)/);
    if (fromPath?.[1]) return fromPath[1];
  } catch {
    return null;
  }
  return parseAmapShareP(url).poiId;
}

/** 高德 `position=lng,lat` 或分享落地页 `p=` 里的 lat,lng → WGS-84。 */
export function extractAmapPosition(url: string): { lat: number; lng: number } | null {
  try {
    const parsed = new URL(url);
    const raw = parsed.searchParams.get('position') || parsed.searchParams.get('to') || parsed.searchParams.get('from');
    if (raw) {
      const [lngPart, latPart] = raw.split(',');
      const gcj = parseAmapLocation(`${lngPart},${latPart}`);
      return gcj ? fromAmap(gcj.lat, gcj.lng) : null;
    }
  } catch {
    return null;
  }
  const share = parseAmapShareP(url).coords;
  return share ? fromAmap(share.lat, share.lng) : null;
}

export function extractAmapName(url: string): string | null {
  try {
    const parsed = new URL(url);
    const name = parsed.searchParams.get('name') || parsed.searchParams.get('poiname');
    if (name?.trim()) return name.trim();
  } catch {
    return null;
  }
  return parseAmapShareP(url).name;
}

export function extractAmapAddress(url: string): string | null {
  return parseAmapShareP(url).address;
}
