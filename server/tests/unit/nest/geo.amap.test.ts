import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  searchAmap,
  autocompleteAmap,
  detailsAmap,
  isAmapPlaceId,
  isAmapShareUrl,
  extractAmapPosition,
  extractAmapPoiId,
  amapText,
  AmapApiError,
} from '../../../src/nest/geo/amap.client';

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
    expect(String((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0])).toContain('extensions=all');
    expect(places).toHaveLength(1);
    expect(places[0].source).toBe('amap');
    expect(places[0].amap_id).toBe('amap:B000A83M61');
    expect(places[0].name).toBe('故宫博物院');
    expect(places[0].phone).toBe('010-85007421');
    expect(places[0].lat).not.toBeNull();
    expect(places[0].lng).not.toBeNull();
    // GCJ → WGS: the pin must move west/south of the raw Amap pair.
    expect(places[0].lng!).toBeLessThan(116.39747);
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
    // Paris pair is outside China — no GCJ shift.
    expect(place?.lat).toBeCloseTo(48.8566, 5);
    expect(place?.lng).toBeCloseTo(2.3522, 5);

    const coord = await detailsAmap('key-1', 'amap:coord:116.391000,39.907000');
    expect(coord?.lat).toBeCloseTo(39.907, 5);
    expect(coord?.lng).toBeCloseTo(116.391, 5);
  });

  it('AMAP-005: recognises Amap share hosts and rejects lookalikes', async () => {
    expect(isAmapShareUrl('https://uri.amap.com/marker?position=116.39,39.90&name=天安门')).toBe(true);
    expect(isAmapShareUrl('https://surl.amap.com/abc')).toBe(true);
    expect(isAmapShareUrl('https://amap.com.evil.example/x')).toBe(false);
    expect(extractAmapPoiId('https://www.amap.com/place/B000A83M61')).toBe('B000A83M61');
    const pos = extractAmapPosition('https://uri.amap.com/marker?position=116.39747,39.908823');
    expect(pos).not.toBeNull();
    expect(pos!.lng).toBeLessThan(116.39747);
  });
});
