import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import type { WeatherResult } from '@trek/shared';
import { readEnv } from '../../app-config';
import { DatabaseService } from '../database/database.service';
import { resolveApiKey } from '../settings/instance-api-keys';
import {
  getWeather,
  getDetailedWeather,
  startCacheCleanup,
  stopCacheCleanup,
  setWeatherAmapKeyResolver,
} from './weather.impl';

/**
 * The weather domain's container face, and the owner of the cache sweep's
 * lifecycle.
 *
 * The Open-Meteo / Amap calls and the response shaping live in weather.impl.ts,
 * which also holds the process-wide cache. That cache stays module state on
 * purpose: MCP tools go through this service into the same singleton cache.
 *
 * What did have to move is the sweep timer — see startCacheCleanup.
 */
@Injectable()
export class WeatherService implements OnModuleInit, OnModuleDestroy {
  constructor(private readonly database: DatabaseService) {}

  onModuleInit(): void {
    // Same chain as MapsService.getAmapKey(0): operator env → instance app_settings.
    setWeatherAmapKeyResolver(
      () => resolveApiKey(this.database, 'amap_api_key', 0, readEnv().maps.amapApiKey).key,
    );
    startCacheCleanup();
  }

  onModuleDestroy(): void {
    stopCacheCleanup();
  }

  get(lat: string, lng: string, date: string | undefined, lang: string, time?: string): Promise<WeatherResult> {
    return getWeather(lat, lng, date, lang, time) as Promise<WeatherResult>;
  }

  getDetailed(lat: string, lng: string, date: string, lang: string): Promise<WeatherResult> {
    return getDetailedWeather(lat, lng, date, lang) as Promise<WeatherResult>;
  }
}
