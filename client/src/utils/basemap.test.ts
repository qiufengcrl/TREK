import { describe, it, expect } from 'vitest'
import { isAmapTileUrl, isVectorStyle, rasterTileLayerOptions, resolveBasemap, resolveTileUrl, tileSubdomainsFor } from './tileUrl'
import {
  OFM_POSITRON,
  AMAP_VEC,
  AMAP_SAT,
  AMAP_SAT_LABEL,
  AMAP_ATTRIBUTION,
  AMAP_SUBDOMAINS,
  AMAP_TILE_MAXZOOM,
  SATELLITE_TILE_URL,
  attributionForTile,
  resolveSatelliteLayer,
  OFM_ATTRIBUTION,
  MAP_MAX_ZOOM,
} from '../constants/mapDefaults'

const CARTO = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
const CUSTOM = 'https://tiles.example.test/{z}/{x}/{y}.png'

describe('isVectorStyle', () => {
  it('FE-UTIL-BASEMAP-001: a style document is one, a tile template is not', () => {
    expect(isVectorStyle(OFM_POSITRON)).toBe(true)
    expect(isVectorStyle('mapbox://styles/mapbox/standard')).toBe(true)
    // The placeholders are what separate the two, not the host.
    expect(isVectorStyle(CUSTOM)).toBe(false)
    expect(isVectorStyle(CARTO)).toBe(false)
    expect(isVectorStyle('')).toBe(false)
    expect(isVectorStyle(null)).toBe(false)
  })
})

describe('resolveTileUrl and the retired CARTO basemaps', () => {
  it('FE-UTIL-BASEMAP-002: a keyless CARTO template falls back to the default', () => {
    // Those tiles come back with "API KEY REQUIRED" burned into them, which is
    // worse than any basemap, so they are not drawn at all. The saved setting is
    // left alone — the Map tab still shows it, with its warning underneath.
    expect(resolveTileUrl(CARTO, OFM_POSITRON)).toBe(OFM_POSITRON)
    expect(resolveTileUrl('https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', OFM_POSITRON)).toBe(OFM_POSITRON)
    expect(resolveTileUrl('https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png', OFM_POSITRON)).toBe(OFM_POSITRON)
  })

  it('FE-UTIL-BASEMAP-003: with a key it is drawn, key appended', () => {
    // Choosing CARTO stays a supported option for whoever holds a key (#2054);
    // it is only no longer the default.
    expect(resolveTileUrl(CARTO, OFM_POSITRON, 'k1')).toBe(`${CARTO}?key=k1`)
  })

  it('FE-UTIL-BASEMAP-004: other providers are never touched', () => {
    expect(resolveTileUrl(CUSTOM, OFM_POSITRON)).toBe(CUSTOM)
    expect(resolveTileUrl(CUSTOM, OFM_POSITRON, 'k1')).toBe(CUSTOM)
    expect(resolveTileUrl('', OFM_POSITRON)).toBe(OFM_POSITRON)
  })
})

describe('resolveBasemap', () => {
  it('FE-UTIL-BASEMAP-005: an unconfigured map gets the vector default', () => {
    expect(resolveBasemap('', OFM_POSITRON)).toEqual({ kind: 'vector', style: OFM_POSITRON })
    expect(resolveBasemap(null, OFM_POSITRON)).toEqual({ kind: 'vector', style: OFM_POSITRON })
  })

  it('FE-UTIL-BASEMAP-006: a template the user configured still wins, as raster', () => {
    expect(resolveBasemap(CUSTOM, OFM_POSITRON)).toEqual({ kind: 'raster', url: CUSTOM })
  })

  it('FE-UTIL-BASEMAP-007: a keyless CARTO template draws the default instead', () => {
    expect(resolveBasemap(CARTO, OFM_POSITRON)).toEqual({ kind: 'vector', style: OFM_POSITRON })
  })

  it('FE-UTIL-BASEMAP-008: with a key it stays raster CARTO', () => {
    expect(resolveBasemap(CARTO, OFM_POSITRON, 'k1')).toEqual({ kind: 'raster', url: `${CARTO}?key=k1` })
  })
})

describe('attributionForTile', () => {
  it('FE-UTIL-BASEMAP-009: OpenFreeMap gets its own credit', () => {
    // Printing OpenStreetMap alone under these tiles is a licence problem: the
    // data is OSM, but the rendering and hosting are not.
    expect(attributionForTile(OFM_POSITRON)).toBe(OFM_ATTRIBUTION)
    expect(attributionForTile(OFM_POSITRON)).toContain('OpenMapTiles')
    expect(attributionForTile(CUSTOM)).toMatch(/OpenStreetMap/)
    expect(attributionForTile(null)).toMatch(/OpenStreetMap/)
  })

  it('FE-UTIL-BASEMAP-010: Amap tiles credit Amap', () => {
    expect(attributionForTile(AMAP_VEC)).toBe(AMAP_ATTRIBUTION)
    expect(attributionForTile(AMAP_SAT)).toBe(AMAP_ATTRIBUTION)
  })
})

describe('Amap basemap helpers', () => {
  it('FE-UTIL-BASEMAP-011: detects Amap tile hosts and uses 1–4 subdomains', () => {
    expect(isAmapTileUrl(AMAP_VEC)).toBe(true)
    expect(isAmapTileUrl(AMAP_SAT)).toBe(true)
    expect(isAmapTileUrl(CUSTOM)).toBe(false)
    expect(isAmapTileUrl('https://foo-amap.com/{z}/{x}/{y}.png')).toBe(false)
    expect(isAmapTileUrl('https://exampleamap.com/{z}/{x}/{y}.png')).toBe(false)
    expect(isAmapTileUrl('https://webrd01.is.autonavi.com/appmaptile?x={x}&y={y}&z={z}')).toBe(true)
    expect(isAmapTileUrl('https://webst01.is.amap.com/appmaptile?x={x}&y={y}&z={z}')).toBe(true)
    expect(tileSubdomainsFor(AMAP_VEC)).toBe(AMAP_SUBDOMAINS)
    expect(tileSubdomainsFor(CUSTOM)).toBe('abc')
  })

  it('FE-UTIL-BASEMAP-012: resolveBasemap keeps Amap as raster', () => {
    expect(resolveBasemap(AMAP_VEC, OFM_POSITRON)).toEqual({ kind: 'raster', url: AMAP_VEC })
  })

  it('FE-UTIL-BASEMAP-013: preferAmap switches satellite to Amap imagery + labels', () => {
    const amap = resolveSatelliteLayer(true)
    expect(amap.url).toBe(AMAP_SAT)
    expect(amap.labelUrl).toBe(AMAP_SAT_LABEL)
    expect(amap.subdomains).toBe(AMAP_SUBDOMAINS)
    expect(amap.maxZoom).toBe(MAP_MAX_ZOOM)
    expect(amap.maxNativeZoom).toBe(AMAP_TILE_MAXZOOM)

    const esri = resolveSatelliteLayer(false)
    expect(esri.url).toBe(SATELLITE_TILE_URL)
    expect(esri.labelUrl).toBeUndefined()
    expect(esri.maxNativeZoom).toBeUndefined()
  })

  it('FE-UTIL-BASEMAP-014: Amap raster layers overzoom native 18 instead of dropping at 19', () => {
    const amap = rasterTileLayerOptions(AMAP_VEC)
    expect(amap.maxZoom).toBe(MAP_MAX_ZOOM)
    expect(amap.maxNativeZoom).toBe(AMAP_TILE_MAXZOOM)
    expect(amap.updateWhenIdle).toBe(false)
    expect(amap.subdomains).toBe(AMAP_SUBDOMAINS)

    const other = rasterTileLayerOptions(CUSTOM)
    expect(other.maxZoom).toBe(MAP_MAX_ZOOM)
    expect(other.maxNativeZoom).toBeUndefined()
  })
})
