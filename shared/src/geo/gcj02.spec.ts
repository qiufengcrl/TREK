import { describe, it, expect } from 'vitest';
import { gcj02ToWgs84, wgs84ToGcj02, outOfChina } from './gcj02';
import { isAmapShareUrl } from './amap-url';

describe('gcj02', () => {
  it('GEO-GCJ-001: leaves points outside China unchanged', () => {
    expect(outOfChina(48.8566, 2.3522)).toBe(true);
    expect(gcj02ToWgs84(48.8566, 2.3522)).toEqual({ lat: 48.8566, lng: 2.3522 });
    expect(wgs84ToGcj02(48.8566, 2.3522)).toEqual({ lat: 48.8566, lng: 2.3522 });
  });

  it('GEO-GCJ-002: Tiananmen GCJ and WGS stay tens of metres apart, and invert', () => {
    const gcj = { lat: 39.908823, lng: 116.39747 };
    const wgs = gcj02ToWgs84(gcj.lat, gcj.lng);
    expect(Math.abs(wgs.lat - gcj.lat)).toBeGreaterThan(0.001);
    expect(Math.abs(wgs.lng - gcj.lng)).toBeGreaterThan(0.001);
    const back = wgs84ToGcj02(wgs.lat, wgs.lng);
    expect(back.lat).toBeCloseTo(gcj.lat, 5);
    expect(back.lng).toBeCloseTo(gcj.lng, 5);
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
