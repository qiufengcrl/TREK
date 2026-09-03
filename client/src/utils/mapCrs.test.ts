import { describe, expect, it } from 'vitest'
import { fromAmap, toAmap } from '@trek/shared'
import { AMAP_VEC, OFM_POSITRON } from '../constants/mapDefaults'
import { fromDisplayLatLng, shiftLatLng, shiftLine, toDisplayLatLng, usesGcjDisplay } from './mapCrs'

describe('mapCrs', () => {
  it('uses GCJ display on Amap street or Amap satellite tiles', () => {
    expect(usesGcjDisplay(AMAP_VEC)).toBe(true)
    expect(usesGcjDisplay(OFM_POSITRON)).toBe(false)
    expect(usesGcjDisplay(OFM_POSITRON, true, true)).toBe(true)
    expect(usesGcjDisplay(OFM_POSITRON, true, false)).toBe(false)
  })

  it('shifts a China point for Amap tiles and inverts a click', () => {
    const wgs = { lat: 39.907, lng: 116.391 }
    const display = toDisplayLatLng(wgs.lat, wgs.lng, true)
    expect(display).toEqual(toAmap(wgs.lat, wgs.lng))
    const back = fromDisplayLatLng(display.lat, display.lng, true)
    expect(back.lat).toBeCloseTo(wgs.lat, 5)
    expect(back.lng).toBeCloseTo(wgs.lng, 5)
    expect(toDisplayLatLng(wgs.lat, wgs.lng, false)).toEqual(wgs)
  })

  it('shiftLatLng leaves overseas points and missing coords alone', () => {
    expect(shiftLatLng({ lat: 48.86, lng: 2.35, name: 'Paris' }, true)).toEqual({
      lat: 48.86, lng: 2.35, name: 'Paris',
    })
    expect(shiftLatLng({ lat: null, lng: null }, true)).toEqual({ lat: null, lng: null })
    const shifted = shiftLatLng({ lat: 39.907, lng: 116.391 }, true)
    expect(shifted).toEqual(toAmap(39.907, 116.391))
    expect(fromAmap(shifted.lat!, shifted.lng!).lat).toBeCloseTo(39.907, 5)
  })

  it('shiftLine converts each vertex on Amap tiles and leaves WGS tiles alone', () => {
    const line: [number, number][] = [[39.907, 116.391], [48.86, 2.35]]
    expect(shiftLine(line, false)).toBe(line)
    const shifted = shiftLine(line, true)
    const beijing = toAmap(39.907, 116.391)
    expect(shifted[0][0]).toBeCloseTo(beijing.lat, 5)
    expect(shifted[0][1]).toBeCloseTo(beijing.lng, 5)
    expect(shifted[1]).toEqual([48.86, 2.35])
  })
})
