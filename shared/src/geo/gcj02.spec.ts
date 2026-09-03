import { describe, it, expect } from 'vitest';
import { fromAmap, gcj02ToWgs84, outOfChina, toAmap, wgs84ToGcj02 } from './gcj02';
import { isAmapShareUrl } from './amap-url';

describe('gcj02', () => {
  it('GEO-GCJ-001: leaves points outside China unchanged', () => {
    expect(outOfChina(48.8566, 2.3522)).toBe(true);
    expect(gcj02ToWgs84(48.8566, 2.3522)).toEqual({ lat: 48.8566, lng: 2.3522 });
    expect(wgs84ToGcj02(48.8566, 2.3522)).toEqual({ lat: 48.8566, lng: 2.3522 });
  });

  it('GEO-GCJ-001b: neighbours inside the official rectangle stay unshifted', () => {
    const neighbours: [string, number, number][] = [
      ['Hanoi', 21.0285, 105.8542],
      ['Ulaanbaatar', 47.8864, 106.9057],
      ['Bishkek', 42.8746, 74.5698],
      ['Taipei', 25.033, 121.5654],
      ['Seoul', 37.5665, 126.978],
      ['Tokyo', 35.6895, 139.6917],
    ];
    for (const [, lat, lng] of neighbours) {
      expect(outOfChina(lat, lng)).toBe(true);
      expect(toAmap(lat, lng)).toEqual({ lat, lng });
    }
    expect(outOfChina(48.8566, 2.3522)).toBe(true);
  });

  it('GEO-GCJ-001c: mainland border cities still convert', () => {
    const inland: [number, number][] = [
      [39.907, 116.391], // Tiananmen
      [21.547, 107.972], // 东兴
      [49.598, 117.431], // 满洲里
      [40.129, 124.395], // 丹东
    ];
    for (const [lat, lng] of inland) {
      expect(outOfChina(lat, lng)).toBe(false);
      const shifted = toAmap(lat, lng);
      expect(shifted.lat).not.toBe(lat);
      expect(shifted.lng).not.toBe(lng);
    }
  });

  it('GEO-GCJ-002: Tiananmen GCJ and WGS stay tens of metres apart, and invert', () => {
    const gcj = { lat: 39.908823, lng: 116.39747 };
    const wgs = gcj02ToWgs84(gcj.lat, gcj.lng);
    expect(Math.abs(wgs.lat - gcj.lat)).toBeGreaterThan(0.001);
    expect(Math.abs(wgs.lng - gcj.lng)).toBeGreaterThan(0.001);
    const back = wgs84ToGcj02(wgs.lat, wgs.lng);
    expect(back.lat).toBeCloseTo(gcj.lat, 5);
    expect(back.lng).toBeCloseTo(gcj.lng, 5);
    expect(toAmap(wgs.lat, wgs.lng)).toEqual(wgs84ToGcj02(wgs.lat, wgs.lng));
    expect(fromAmap(gcj.lat, gcj.lng)).toEqual(wgs);
  });
});

describe('isAmapShareUrl', () => {
  it('accepts amap / gaode hosts and rejects lookalikes', () => {
    expect(isAmapShareUrl('https://uri.amap.com/marker?position=1,2')).toBe(true);
    expect(isAmapShareUrl('https://surl.amap.com/x')).toBe(true);
    expect(isAmapShareUrl('https://www.gaode.com/place/B000')).toBe(true);
    expect(isAmapShareUrl('https://amap.com.evil.example/x')).toBe(false);
    expect(isAmapShareUrl('not a url')).toBe(false);
  });
});
