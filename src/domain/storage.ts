import type { BeanPreset } from '../api/types';

const lastBeanKey = 'beanie:last-bean-id';

export function readLastBeanId(): string | null {
  return localStorage.getItem(lastBeanKey);
}

export function writeLastBeanId(beanId: string): void {
  localStorage.setItem(lastBeanKey, beanId);
}

export function readPresets(beanId: string): BeanPreset[] {
  try {
    const raw = localStorage.getItem(presetKey(beanId));
    return raw ? (JSON.parse(raw) as BeanPreset[]) : [];
  } catch {
    return [];
  }
}

export function writePresets(beanId: string, presets: BeanPreset[]): void {
  localStorage.setItem(presetKey(beanId), JSON.stringify(presets));
}

function presetKey(beanId: string): string {
  return `beanie:presets:${beanId}`;
}

const favoriteProfilesKey = 'beanie:favorite-profiles';

export function readFavoriteProfiles(): string[] {
  try {
    const raw = localStorage.getItem(favoriteProfilesKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function writeFavoriteProfiles(ids: string[]): void {
  localStorage.setItem(favoriteProfilesKey, JSON.stringify([...new Set(ids)]));
}
