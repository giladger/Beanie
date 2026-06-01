import type { BeanPreset } from '../api/types';

const lastBeanKey = 'beanie:last-bean-id';
const autoLoadKey = 'beanie:auto-load';

export function readLastBeanId(): string | null {
  return localStorage.getItem(lastBeanKey);
}

export function writeLastBeanId(beanId: string): void {
  localStorage.setItem(lastBeanKey, beanId);
}

export function readAutoLoad(): boolean {
  const stored = localStorage.getItem(autoLoadKey);
  return stored == null ? true : stored === '1';
}

export function writeAutoLoad(enabled: boolean): void {
  localStorage.setItem(autoLoadKey, enabled ? '1' : '0');
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
