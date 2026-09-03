export const DEFAULT_MAP_LAT = 0
export const DEFAULT_MAP_LNG = 0
export const DEFAULT_MAP_ZOOM = 2
export const DEFAULT_MAP_CENTER: [number, number] = [DEFAULT_MAP_LAT, DEFAULT_MAP_LNG]

/**
 * Zoom ceiling for a Leaflet map, set on the map rather than on its base layer.
 *
 * Leaflet answers `getMaxZoom()` from the map options first and only then from a
 * layer that carried one, and only a GridLayer ever contributes: a vector
 * basemap is a GL canvas, so a map drawn by one has no ceiling from anywhere.
 * `MarkerClusterGroup.onAdd` refuses an infinite ceiling by throwing, which is
 * how a basemap choice could take down the whole planner. Matches the raster and
 * satellite layers so nothing changes for the maps that already had one.
 */
export const MAP_MAX_ZOOM = 19

// Tokenless satellite base layer (ESRI World Imagery) — works without an API key.
// Prefer Amap imagery when the instance has an Amap key or the street basemap
// is already Amap (pins are shifted WGS→GCJ for display on those tiles).
export const SATELLITE_TILE_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
export const SATELLITE_TILE_ATTRIBUTION =
  'Imagery &copy; <a href="https://www.esri.com">Esri</a>, Maxar, Earthstar Geographics'
export const SATELLITE_TILE_MAXZOOM = 19

/**
 * Amap (Gaode) raster tiles — GCJ-02. Stock places stay WGS; MapView shifts pins.
 * Classic CDN hosts; Leaflet `{s}` rotates 1–4. Road style includes labels;
 * satellite (style=6) needs the companion label layer (style=8).
 */
export const AMAP_SUBDOMAINS = '1234'
export const AMAP_VEC =
  'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}'
export const AMAP_SAT =
  'https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}'
export const AMAP_SAT_LABEL =
  'https://webst0{s}.is.autonavi.com/appmaptile?style=8&x={x}&y={y}&z={z}'
export const AMAP_ATTRIBUTION =
  '&copy; <a href="https://lbs.amap.com/">Amap</a>'
/**
 * Highest zoom Amap actually paints. z=19 comes back as a ~200-byte blank
 * placeholder; the map ceiling stays at MAP_MAX_ZOOM (19) and Amap layers
 * overzoom native 18 via maxNativeZoom rather than requesting those empties
 * or unloading at the last wheel tick.
 */
export const AMAP_TILE_MAXZOOM = 18

// OpenFreeMap, the default basemap since CARTO began watermarking keyless tiles
// on 26.08.2026 and moved its key behind a request by mail. No key, no
// registration, no request limits, commercial use allowed, attribution required.
//
// These are MapLibre STYLE documents, not {z}/{x}/{y} templates: OpenFreeMap
// serves vector tiles only. Leaflet draws them through VectorBasemap. Positron
// is the same design CARTO's light basemap was, so the maps look like they did.
// China installs with an Amap key fall back to AMAP_VEC (pins shifted for GCJ tiles).
export const OFM_POSITRON = 'https://tiles.openfreemap.org/styles/positron'
export const OFM_DARK = 'https://tiles.openfreemap.org/styles/dark'
export const OFM_ATTRIBUTION =
  '<a href="https://openfreemap.org">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'

const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'

/**
 * Attribution for whatever basemap a map ended up with. OpenFreeMap asks for a
 * credit of its own, and printing OpenStreetMap alone under its tiles is both
 * wrong and a licence problem, so the URL decides rather than a flag at the
 * call site.
 */
export function attributionForTile(url: string | null | undefined): string {
  if (!url) return OSM_ATTRIBUTION
  if (url.includes('openfreemap.org')) return OFM_ATTRIBUTION
  if (url.includes('autonavi.com') || url.includes('amap.com')) return AMAP_ATTRIBUTION
  if (url.includes('arcgisonline.com')) return SATELLITE_TILE_ATTRIBUTION
  return OSM_ATTRIBUTION
}

export type SatelliteLayer = {
  url: string
  attribution: string
  maxZoom: number
  /** Cap on tiles the CDN actually has; omit to request every map zoom. */
  maxNativeZoom?: number
  subdomains: string
  /** Annotation overlay for Amap imagery (imagery itself has no labels). */
  labelUrl?: string
}

/**
 * Street basemap already on Amap, or an Amap Web-service key on the instance →
 * use Amap imagery so mainland pins (shifted to GCJ for display) sit on matching
 * tiles. Otherwise keep ESRI.
 */
export function resolveSatelliteLayer(preferAmap: boolean): SatelliteLayer {
  if (preferAmap) {
    return {
      url: AMAP_SAT,
      attribution: AMAP_ATTRIBUTION,
      maxZoom: MAP_MAX_ZOOM,
      maxNativeZoom: AMAP_TILE_MAXZOOM,
      subdomains: AMAP_SUBDOMAINS,
      labelUrl: AMAP_SAT_LABEL,
    }
  }
  return {
    url: SATELLITE_TILE_URL,
    attribution: SATELLITE_TILE_ATTRIBUTION,
    maxZoom: SATELLITE_TILE_MAXZOOM,
    subdomains: 'abc',
  }
}

// CARTO basemaps. Keyless tiles carry an "API KEY REQUIRED" watermark since
// 26.08.2026, so these are always passed through withTileApiKey() (#2054).
// Kept as an opt-in for operators who hold a key; nothing defaults to them.
export const CARTO_LIGHT = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
export const CARTO_DARK = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
export const CARTO_LIGHT_NOLABELS = 'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png'
export const CARTO_DARK_NOLABELS = 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png'
export const CARTO_VOYAGER = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png'
