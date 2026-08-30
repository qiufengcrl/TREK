/**
 * 高德 Web 服务（国内地点搜索）。
 *
 * 固定打 restapi.amap.com，和 Nominatim 客户端一样：超时、识别 UA、
 * 把上游空数组收成空字符串。坐标在 gcj02 里转成 WGS-84。
 */

import { UA } from '../maps/maps.helpers';
import { parseAmapLocation, wgs84ToGcj02 } from './gcj02';

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
  osm_id: null;
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
  regeocode?: { formatted_address?: unknown; addressComponent?: { building?: { name?: unknown } } };
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
  const gcj = wgs84ToGcj02(bias.lat, bias.lng);
  params.set('location', `${gcj.lng},${gcj.lat}`);
}

async function amapFetch(path: string, params: URLSearchParams): Promise<AmapEnvelope> {
  await throttle();
  const url = `${BASE}${path}?${params.toString()}`;
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Amap request failed';
    throw new AmapApiError(`Amap request failed: ${message}`, 502);
  }
  if (!response.ok) {
    throw new AmapApiError(`Amap API error: ${response.status} ${response.statusText}`, response.status);
  }
  const data = (await response.json()) as AmapEnvelope;
  if (data.status !== '1') {
    const info = amapText(data.info) || 'Amap API error';
    const invalidKey = data.infocode === '10001' || data.infocode === '10004';
    throw new AmapApiError(info, invalidKey ? 403 : 502, data.infocode);
  }
  return data;
}

function mapPoi(poi: AmapPoi): AmapMappedPlace {
  const coords = parseAmapLocation(poi.location);
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
  return (data.pois ?? []).map(mapPoi);
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
  const suggestions = (data.tips ?? [])
    .map((tip) => {
      const id = amapText(tip.id);
      const name = amapText(tip.name);
      const secondary = [amapText(tip.district), amapText(tip.address)].filter(Boolean).join(' ');
      if (!name) return null;
      // No POI id: encode WGS coords plus the tip name so details does not
      // wipe the label the user just picked.
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
      lat,
      lng,
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
  const poi = data.pois?.[0];
  return poi ? mapPoi(poi) : null;
}

export async function reverseAmap(
  key: string,
  lat: string,
  lng: string,
): Promise<{ name: string | null; address: string | null }> {
  const wgsLat = Number.parseFloat(lat);
  const wgsLng = Number.parseFloat(lng);
  if (!Number.isFinite(wgsLat) || !Number.isFinite(wgsLng)) return { name: null, address: null };
  const gcj = wgs84ToGcj02(wgsLat, wgsLng);
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

/** 高德分享 / 短链 / 开放平台 URI，不含伪装成 *.amap.com.evil.com 的主机。 */
export function isAmapShareUrl(input: string): boolean {
  try {
    const host = new URL(input.trim()).hostname.toLowerCase();
    return host === 'amap.com' || host.endsWith('.amap.com') || host === 'gaode.com' || host.endsWith('.gaode.com');
  } catch {
    return false;
  }
}

export function extractAmapPoiId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const fromQuery = parsed.searchParams.get('poiid') || parsed.searchParams.get('id');
    if (fromQuery && /^[A-Za-z0-9]+$/.test(fromQuery)) return fromQuery;
    const fromPath = parsed.pathname.match(/\/place\/([A-Za-z0-9]+)/);
    return fromPath?.[1] ?? null;
  } catch {
    return null;
  }
}

/** 高德 `position=lng,lat`（GCJ-02）。 */
export function extractAmapPosition(url: string): { lat: number; lng: number } | null {
  try {
    const parsed = new URL(url);
    const raw = parsed.searchParams.get('position') || parsed.searchParams.get('to') || parsed.searchParams.get('from');
    if (!raw) return null;
    const [lngPart, latPart] = raw.split(',');
    return parseAmapLocation(`${lngPart},${latPart}`);
  } catch {
    return null;
  }
}

export function extractAmapName(url: string): string | null {
  try {
    const parsed = new URL(url);
    const name = parsed.searchParams.get('name') || parsed.searchParams.get('poiname');
    return name?.trim() || null;
  } catch {
    return null;
  }
}
