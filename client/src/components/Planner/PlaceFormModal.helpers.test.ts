import { describe, it, expect } from 'vitest'
import { isAmapShareUrl, isGoogleMapsUrl, isShareMapUrl, withFallbackName } from './PlaceFormModal.helpers'

describe('isGoogleMapsUrl', () => {
  it('accepts the short share hosts', () => {
    expect(isGoogleMapsUrl('https://maps.app.goo.gl/abc123')).toBe(true)
    expect(isGoogleMapsUrl('https://goo.gl/maps/xyz')).toBe(true)
  })

  it('rejects goo.gl links that are not /maps', () => {
    expect(isGoogleMapsUrl('https://goo.gl/something')).toBe(false)
  })

  it('accepts maps.google.<tld> and maps.google.<sld>.<tld>', () => {
    expect(isGoogleMapsUrl('https://maps.google.com/?q=eiffel')).toBe(true)
    expect(isGoogleMapsUrl('https://maps.google.co.uk/?q=eiffel')).toBe(true)
  })

  it('accepts google.<tld>/maps with optional www', () => {
    expect(isGoogleMapsUrl('https://google.com/maps/place/Eiffel')).toBe(true)
    expect(isGoogleMapsUrl('https://www.google.co.uk/maps')).toBe(true)
  })

  it('rejects google.<tld> without a /maps path', () => {
    expect(isGoogleMapsUrl('https://google.com/search?q=eiffel')).toBe(false)
  })

  it('rejects spoofed hosts like maps.google.evil.com', () => {
    expect(isGoogleMapsUrl('https://maps.google.evil.com/maps')).toBe(false)
  })

  it('returns false for non-URL input', () => {
    expect(isGoogleMapsUrl('not a url')).toBe(false)
    expect(isGoogleMapsUrl('')).toBe(false)
    expect(isGoogleMapsUrl('Eiffel Tower')).toBe(false)
  })

  it('trims surrounding whitespace before parsing', () => {
    expect(isGoogleMapsUrl('  https://maps.app.goo.gl/abc123  ')).toBe(true)
  })
})

describe('isAmapShareUrl', () => {
  it('accepts amap / gaode hosts', () => {
    expect(isAmapShareUrl('https://uri.amap.com/marker?position=1,2')).toBe(true)
    expect(isAmapShareUrl('https://www.amap.com/place/B000')).toBe(true)
    expect(isShareMapUrl('https://surl.amap.com/x')).toBe(true)
  })

  it('rejects lookalike hosts', () => {
    expect(isAmapShareUrl('https://amap.com.evil.example/x')).toBe(false)
    expect(isShareMapUrl('Eiffel Tower')).toBe(false)
  })
})

describe('withFallbackName', () => {
  it('keeps a real details name and fills an empty one from the suggestion', () => {
    expect(withFallbackName({ name: '故宫', lat: 39.9 }, '某路口').name).toBe('故宫')
    expect(withFallbackName({ name: '', lat: 39.9 }, '某路口').name).toBe('某路口')
    expect(withFallbackName({ lat: 39.9 }, '某路口').name).toBe('某路口')
  })
})
