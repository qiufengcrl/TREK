/**
 * Amap tiles stop at z=18; the planner map ceiling is 19. Leaflet GridLayer
 * semantics of that mismatch, with no mocks: a layer maxZoom below the map
 * zoom unloads every tile (grey canvas); maxNativeZoom keeps the last real
 * tiles and scales them.
 */
import { describe, it, expect, afterEach } from 'vitest'
import L from 'leaflet'
import { MAP_MAX_ZOOM, AMAP_TILE_MAXZOOM, AMAP_VEC } from '../../constants/mapDefaults'
import { rasterTileLayerOptions } from '../../utils/tileUrl'

const containers: HTMLElement[] = []

function mapOn(options: L.MapOptions): L.Map {
  const el = document.createElement('div')
  Object.defineProperty(el, 'clientWidth', { value: 800 })
  Object.defineProperty(el, 'clientHeight', { value: 600 })
  document.body.appendChild(el)
  containers.push(el)
  return L.map(el, { center: [28.69, 115.87], zoom: 16, ...options })
}

afterEach(() => {
  for (const el of containers.splice(0)) el.remove()
})

describe('Amap tile zoom vs the map ceiling', () => {
  it('AMAPZOOM-001: layer maxZoom 18 on a map that goes to 19 drops tiles at the ceiling', () => {
    const map = mapOn({ maxZoom: MAP_MAX_ZOOM })
    const layer = L.tileLayer('https://example.test/{z}/{x}/{y}.png', { maxZoom: AMAP_TILE_MAXZOOM }).addTo(map)
    map.setZoom(MAP_MAX_ZOOM)
    expect((layer as unknown as { _tileZoom?: number })._tileZoom).toBeUndefined()
  })

  it('AMAPZOOM-002: maxNativeZoom 18 with maxZoom 19 keeps z=18 tiles at the ceiling', () => {
    const map = mapOn({ maxZoom: MAP_MAX_ZOOM })
    const layer = L.tileLayer('https://example.test/{z}/{x}/{y}.png', {
      maxZoom: MAP_MAX_ZOOM,
      maxNativeZoom: AMAP_TILE_MAXZOOM,
    }).addTo(map)
    map.setZoom(MAP_MAX_ZOOM)
    expect((layer as unknown as { _tileZoom?: number })._tileZoom).toBe(AMAP_TILE_MAXZOOM)
  })

  it('AMAPZOOM-003: rasterTileLayerOptions for Amap is the overzoom pair, not the dropping one', () => {
    const opts = rasterTileLayerOptions(AMAP_VEC)
    const map = mapOn({ maxZoom: MAP_MAX_ZOOM })
    const layer = L.tileLayer(AMAP_VEC, opts).addTo(map)
    map.setZoom(MAP_MAX_ZOOM)
    expect((layer as unknown as { _tileZoom?: number })._tileZoom).toBe(AMAP_TILE_MAXZOOM)
  })
})
