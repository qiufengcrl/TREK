import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { http, HttpResponse } from 'msw'
import { render, screen } from '../../../tests/helpers/render'
import { server } from '../../../tests/helpers/msw/server'
import { toAmap } from '@trek/shared'
import type { PluginMapMarker } from '../../api/client'

vi.mock('react-leaflet', () => ({
  Marker: ({ children, position }: { children?: React.ReactNode; position: [number, number] }) => (
    <div data-testid="plugin-marker" data-lat={position[0]} data-lng={position[1]}>{children}</div>
  ),
  Popup: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('leaflet', () => {
  const divIcon = vi.fn((options: Record<string, unknown>) => ({ options }))
  return { default: { divIcon }, divIcon }
})

import { PluginMapMarkers } from './MapPluginMarkers'

beforeEach(() => {
  server.use(http.get('/api/map-layers/:tripId', () => HttpResponse.json({ layers: [] })))
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('PluginMapMarkers', () => {
  it('FE-COMP-MAPPLUGINMARKERS-001: Amap tiles shift a Beijing plugin pin to GCJ', async () => {
    const marker: PluginMapMarker = {
      pluginId: 'ev',
      id: 'm1',
      lat: 39.907,
      lng: 116.391,
      tone: 'default',
      label: 'Depot',
    }
    server.use(http.get('/api/map-markers/:tripId', () => HttpResponse.json({ markers: [marker] })))

    render(<PluginMapMarkers tripId={4} gcjTiles />)
    const el = await screen.findByTestId('plugin-marker')
    const gcj = toAmap(39.907, 116.391)
    expect(Number(el.getAttribute('data-lat'))).toBeCloseTo(gcj.lat, 5)
    expect(Number(el.getAttribute('data-lng'))).toBeCloseTo(gcj.lng, 5)
  })

  it('FE-COMP-MAPPLUGINMARKERS-002: WGS tiles keep the stored coordinates', async () => {
    const marker: PluginMapMarker = {
      pluginId: 'ev',
      id: 'm1',
      lat: 39.907,
      lng: 116.391,
      tone: 'default',
    }
    server.use(http.get('/api/map-markers/:tripId', () => HttpResponse.json({ markers: [marker] })))

    render(<PluginMapMarkers tripId={4} />)
    const el = await screen.findByTestId('plugin-marker')
    expect(Number(el.getAttribute('data-lat'))).toBeCloseTo(39.907, 5)
    expect(Number(el.getAttribute('data-lng'))).toBeCloseTo(116.391, 5)
  })
})
