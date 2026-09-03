import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  searchAmap,
  autocompleteAmap,
  detailsAmap,
  aroundAmap,
  weatherAmap,
  CATEGORY_AMAP_TYPECODES,
  isAmapPlaceId,
  isAmapShareUrl,
  extractAmapPoiId,
  extractAmapPosition,
  extractAmapName,
  amapText,
  parseAmapPolyline,
  routeAmap,
  AmapApiError,
} from '../../../src/nest/geo/amap.client';
import { fromAmap } from '../../../src/nest/geo/gcj02';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('amap.client', () => {
  it('AMAP-001: maps a text-search POI and prefixes the id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: '1',
          pois: [
            {
              id: 'B000A83M61',
              name: '故宫博物院',
              address: '北京市东城区',
              location: '116.39747,39.908823',
              tel: '010-85007421',
              type: '风景名胜;博物馆',
            },
          ],
        }),
      }),
    );

    const places = await searchAmap('key-1', '故宫');
    expect(places).toHaveLength(1);
    expect(places[0].source).toBe('amap');
    expect(places[0].amap_id).toBe('amap:B000A83M61');
    expect(places[0].osm_id).toBe('amap:B000A83M61');
    expect(places[0].name).toBe('故宫博物院');
    expect(places[0].phone).toBe('010-85007421');
    expect(places[0].lat).not.toBeNull();
    expect(places[0].lng).not.toBeNull();
    const wgs = fromAmap(39.908823, 116.39747);
    expect(places[0].lng!).toBeCloseTo(wgs.lng, 5);
    expect(places[0].lat!).toBeCloseTo(wgs.lat, 5);
    expect(String((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0])).toContain('extensions=all');
  });

  it('AMAP-002: treats [] empty fields as blank and throws on a bad key', async () => {
    expect(amapText([])).toBe('');
    expect(amapText('  天安门  ')).toBe('天安门');
    expect(isAmapPlaceId('amap:B000')).toBe(true);
    expect(isAmapPlaceId('ChIJ123')).toBe(false);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: '0', infocode: '10001', info: 'INVALID_USER_KEY' }),
      }),
    );
    await expect(searchAmap('bad', 'x')).rejects.toBeInstanceOf(AmapApiError);
    await expect(searchAmap('bad', 'x')).rejects.toMatchObject({ status: 403, message: 'INVALID_USER_KEY' });
  });

  it('AMAP-003: autocomplete uses a coord fallback when the tip has no id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: '1',
          tips: [
            { id: [], name: '某路口', district: '北京市', address: [], location: '116.40,39.90' },
            { id: 'B111', name: '故宫', district: '北京市东城区', address: '景山前街', location: '116.39747,39.908823' },
          ],
        }),
      }),
    );
    const { suggestions, source } = await autocompleteAmap('key-1', '故');
    expect(source).toBe('amap');
    expect(suggestions[0].placeId).toMatch(/^amap:coord:/);
    expect(suggestions[0].placeId).toContain(encodeURIComponent('某路口'));
    expect(suggestions[1].placeId).toBe('amap:B111');
    expect(suggestions[1].mainText).toBe('故宫');
  });

  it('AMAP-004: details reads a POI id and a coord placeholder', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: '1',
          pois: [{ id: 'B000', name: '天安门', address: '北京市', location: '2.3522,48.8566' }],
        }),
      }),
    );
    const place = await detailsAmap('key-1', 'amap:B000');
    expect(place?.name).toBe('天安门');
    expect(place?.osm_id).toBe(place?.amap_id);
    // Paris pair is outside China — no GCJ shift.
    expect(place?.lat).toBeCloseTo(48.8566, 5);
    expect(place?.lng).toBeCloseTo(2.3522, 5);

    const named = await detailsAmap('key-1', `amap:coord:116.391000,39.907000:${encodeURIComponent('某路口')}`);
    const namedWgs = fromAmap(39.907, 116.391);
    expect(named?.lat).toBeCloseTo(namedWgs.lat, 5);
    expect(named?.lng).toBeCloseTo(namedWgs.lng, 5);
    expect(named?.name).toBe('某路口');
    expect(named?.osm_id).toBe(named?.amap_id);

    const coord = await detailsAmap('key-1', 'amap:coord:116.391000,39.907000');
    expect(coord?.lat).toBeCloseTo(namedWgs.lat, 5);
    expect(coord?.lng).toBeCloseTo(namedWgs.lng, 5);
    expect(coord?.name).toBe('');
  });

  it('AMAP-005: share-URL helpers accept Amap hosts and reject look-alikes', () => {
    expect(isAmapShareUrl('https://uri.amap.com/marker?position=116.39,39.90')).toBe(true);
    expect(isAmapShareUrl('https://surl.amap.com/abc')).toBe(true);
    expect(isAmapShareUrl('https://amap.com.evil.example/marker')).toBe(false);
    expect(extractAmapPoiId('https://uri.amap.com/marker?poiid=B000A83M61')).toBe('B000A83M61');
    const pos = extractAmapPosition('https://uri.amap.com/marker?position=116.39747,39.908823');
    const posWgs = fromAmap(39.908823, 116.39747);
    expect(pos?.lng).toBeCloseTo(posWgs.lng, 5);
    expect(pos?.lat).toBeCloseTo(posWgs.lat, 5);
  });

  it('AMAP-007: parses the App share landing ?p=poiid,lat,lng,name,address', () => {
    const url = 'https://www.amap.com/?p=B0G16U0P5K,31.140408668664158,121.11573144793509,青溪园,青浦区淀浦河南侧';
    expect(extractAmapPoiId(url)).toBe('B0G16U0P5K');
    const pos = extractAmapPosition(url);
    const shareWgs = fromAmap(31.140408668664158, 121.11573144793509);
    expect(pos?.lat).toBeCloseTo(shareWgs.lat, 5);
    expect(pos?.lng).toBeCloseTo(shareWgs.lng, 5);
    expect(extractAmapName(url)).toBe('青溪园');
  });

  it('AMAP-006: search and autocomplete convert WGS bias to GCJ location=', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: '1', pois: [], tips: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const wgs = fromAmap(39.908823, 116.39747);
    await searchAmap('key-1', '故宫', wgs);
    await autocompleteAmap('key-1', '故', wgs);
    for (const call of fetchMock.mock.calls) {
      const url = String(call[0]);
      expect(url).toContain('location=');
      const loc = new URL(url).searchParams.get('location');
      const [lng, lat] = (loc ?? '').split(',').map(Number);
      expect(lat).toBeCloseTo(39.908823, 4);
      expect(lng).toBeCloseTo(116.39747, 4);
    }
  });

  it('AMAP-008: refuses a non-array pois body and an oversized declared length', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: '1', pois: { not: 'an array' } }),
      }),
    );
    await expect(searchAmap('key-1', 'x')).resolves.toEqual([]);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: (n: string) => (n.toLowerCase() === 'content-length' ? String(2 * 1024 * 1024) : null) },
        json: async () => ({ status: '1', pois: [] }),
      }),
    );
    await expect(searchAmap('key-1', 'x')).rejects.toMatchObject({ status: 502 });
  });

  it('AMAP-009: parseAmapPolyline keeps GCJ vertices as [lat,lng]', () => {
    const pts = parseAmapPolyline('116.39747,39.908823;116.40,39.91');
    expect(pts).toHaveLength(2);
    expect(pts[0]).toEqual([39.908823, 116.39747]);
    expect(pts[1]).toEqual([39.91, 116.4]);
    expect(parseAmapPolyline('')).toEqual([]);
  });

  it('AMAP-010: routeAmap builds one leg per pair and hits the v5 direction path', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: '1',
        route: {
          paths: [
            {
              distance: '1500',
              cost: { duration: '240' },
              steps: [{ polyline: '116.40,39.90;116.41,39.91' }],
            },
          ],
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await routeAmap('key-1', 'driving', [
      { lat: 39.9, lng: 116.4 },
      { lat: 39.91, lng: 116.41 },
      { lat: 39.92, lng: 116.42 },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]![0])).toContain('/v5/direction/driving');
    expect(String(fetchMock.mock.calls[0]![0])).toContain('show_fields=cost%2Cpolyline');
    expect(result.legs).toHaveLength(2);
    expect(result.distance).toBe(3000);
    expect(result.duration).toBe(480);
    expect(result.coordinates.length).toBeGreaterThanOrEqual(2);
  });

  it('AMAP-011: routeAmap throws when Amap returns no path', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: '1', route: { paths: [] } }),
      }),
    );
    await expect(
      routeAmap('key-1', 'walking', [
        { lat: 39.9, lng: 116.4 },
        { lat: 39.91, lng: 116.41 },
      ]),
    ).rejects.toBeInstanceOf(AmapApiError);
  });

  it('AMAP-012: routeAmap stops further legs when the abort signal fires', async () => {
    const ac = new AbortController();
    const fetchMock = vi.fn().mockImplementation(async () => {
      ac.abort();
      return {
        ok: true,
        json: async () => ({
          status: '1',
          route: {
            paths: [
              {
                distance: '100',
                cost: { duration: '30' },
                steps: [{ polyline: '116.40,39.90;116.41,39.91' }],
              },
            ],
          },
        }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      routeAmap(
        'key-1',
        'driving',
        [
          { lat: 39.9, lng: 116.4 },
          { lat: 39.91, lng: 116.41 },
          { lat: 39.92, lng: 116.42 },
        ],
        ac.signal,
      ),
    ).rejects.toMatchObject({ message: expect.stringMatching(/abort/i) });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('AMAP-around: queries /v3/place/around with GCJ location and typecodes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: '1',
        pois: [
          {
            id: 'B001',
            name: '全聚德',
            address: '前门',
            location: '116.40,39.90',
            type: '餐饮服务;中餐厅',
            photos: [{ url: 'https://store.is.autonavi.com/pic.jpg' }],
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const places = await aroundAmap('key-1', CATEGORY_AMAP_TYPECODES.restaurant, { lat: 39.9, lng: 116.4 }, { radius: 2000 });
    expect(places).toHaveLength(1);
    expect(places[0].amap_id).toBe('amap:B001');
    expect(places[0].image_url).toContain('autonavi.com');
    expect(String(fetchMock.mock.calls[0][0])).toContain('/v3/place/around');
    expect(String(fetchMock.mock.calls[0][0])).toContain('116.4');
  });

  it('AMAP-weather: resolves adcode via regeo then weatherInfo', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: '1',
          regeocode: { addressComponent: { adcode: '110101', city: '北京市' } },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: '1',
          lives: [{ city: '北京', weather: '晴', temperature: '22' }],
          forecasts: [],
        }),
      });
    vi.stubGlobal('fetch', fetchMock);
    const w = await weatherAmap('key-1', 39.9, 116.4);
    expect(w?.temperature).toBe('22');
    expect(w?.weather).toBe('晴');
    expect(String(fetchMock.mock.calls[1][0])).toContain('weather/weatherInfo');
    expect(String(fetchMock.mock.calls[1][0])).toContain('city=110101');
  });
});
