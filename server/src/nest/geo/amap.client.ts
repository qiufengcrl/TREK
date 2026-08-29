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
  rating: null;
  website: null;
  phone: string | null;
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

async function amapFetch(path: string, params: URLSearchParams): Promise<AmapEnvelope> {
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
  return {
    google_place_id: null,
    google_ftid: null,
    osm_id: null,
    amap_id: id ? `${AMAP_PLACE_PREFIX}${id}` : null,
    name: amapText(poi.name),
    address,
    lat: coords?.lat ?? null,
    lng: coords?.lng ?? null,
    rating: null,
    website: null,
    phone: amapText(poi.tel) || null,
    types,
    source: 'amap',
  };
}

export async function searchAmap(key: string, query: string): Promise<AmapMappedPlace[]> {
  const params = new URLSearchParams({
    key,
    keywords: query,
    offset: '10',
    page: '1',
    extensions: 'base',
  });
  const data = await amapFetch('/v3/place/text', params);
  return (data.pois ?? []).map(mapPoi);
}

export async function autocompleteAmap(
  key: string,
  input: string,
): Promise<{ suggestions: { placeId: string; mainText: string; secondaryText: string }[]; source: string }> {
  const params = new URLSearchParams({
    key,
    keywords: input,
  });
  const data = await amapFetch('/v3/assistant/inputtips', params);
  const suggestions = (data.tips ?? [])
    .map((tip) => {
      const id = amapText(tip.id);
      const name = amapText(tip.name);
      const secondary = [amapText(tip.district), amapText(tip.address)].filter(Boolean).join(' ');
      if (!name) return null;
      // 没有 POI id 时用坐标占位，点选后走 details 的坐标回退。
      const coords = parseAmapLocation(tip.location);
      const placeId = id
        ? `${AMAP_PLACE_PREFIX}${id}`
        : coords
          ? `${AMAP_PLACE_PREFIX}coord:${coords.lng.toFixed(6)},${coords.lat.toFixed(6)}`
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
    const [lngRaw, latRaw] = raw.split(',');
    const lat = Number.parseFloat(latRaw ?? '');
    const lng = Number.parseFloat(lngRaw ?? '');
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return {
      google_place_id: null,
      google_ftid: null,
      osm_id: null,
      amap_id: placeId,
      name: '',
      address: '',
      lat,
      lng,
      rating: null,
      website: null,
      phone: null,
      types: [],
      source: 'amap',
    };
  }
  if (!rest) return null;
  const params = new URLSearchParams({ key, id: rest, extensions: 'base' });
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
