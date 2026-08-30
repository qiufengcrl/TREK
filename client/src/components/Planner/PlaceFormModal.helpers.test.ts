import { describe, it, expect } from 'vitest'
import { extractShareCardName, extractShareMapUrl, isAmapShareUrl, isGoogleMapsUrl, isShareMapUrl, mergeResult, shareResolveToResult, withFallbackName } from './PlaceFormModal.helpers'

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

describe('extractShareMapUrl', () => {
  it('pulls an Amap short link out of an App share card', () => {
    const card = '青溪园\n社区公园\n青浦区淀浦河南侧\nhttps://surl.amap.com/e8M6xk6V62B'
    expect(extractShareMapUrl(card)).toBe('https://surl.amap.com/e8M6xk6V62B')
  })

  it('returns a bare share URL unchanged', () => {
    expect(extractShareMapUrl('https://surl.amap.com/e8M6xk6V62B')).toBe('https://surl.amap.com/e8M6xk6V62B')
  })

  it('returns null when there is no map URL', () => {
    expect(extractShareMapUrl('青溪园')).toBeNull()
  })
})

describe('shareResolveToResult + mergeResult', () => {
  it('clears the previous pick\'s provider ids when a share URL resolves', () => {
    const autoFilled = new Set(['name', 'address', 'lat', 'lng', 'google_place_id', 'google_ftid', 'osm_id', 'website'] as const)
    const prev = {
      name: 'Hamburg Airport',
      address: 'Airport',
      lat: '53.6',
      lng: '10.0',
      category_id: '',
      place_time: '',
      end_time: '',
      notes: '',
      transport_mode: 'walking',
      website: 'https://ham.example',
      description: '',
      google_place_id: 'ChIJ-old',
      google_ftid: '0xold',
      osm_id: 'node:1',
    }
    const next = mergeResult(
      prev,
      shareResolveToResult({ lat: 31.1, lng: 121.2, name: null, address: '青浦区', google_ftid: null }, '青溪园'),
      autoFilled,
    )
    expect(next.name).toBe('青溪园')
    expect(next.address).toBe('青浦区')
    expect(next.lat).toBe('31.1')
    expect(next.google_place_id).toBe('')
    expect(next.google_ftid).toBe('')
    expect(next.osm_id).toBe('')
    expect(next.website).toBe('')
  })

  it('extractShareCardName takes the first non-URL line', () => {
    expect(extractShareCardName('青溪园\n社区公园\nhttps://surl.amap.com/x')).toBe('青溪园')
  })
})

describe('withFallbackName', () => {
  it('keeps a real details name and fills an empty one from the suggestion', () => {
    expect(withFallbackName({ name: '故宫', lat: 39.9 }, '某路口').name).toBe('故宫')
    expect(withFallbackName({ name: '', lat: 39.9 }, '某路口').name).toBe('某路口')
    expect(withFallbackName({ lat: 39.9 }, '某路口').name).toBe('某路口')
  })
})
