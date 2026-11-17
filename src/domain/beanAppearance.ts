import type { Bean, BeanBatch } from '../api/types';

export const COFFEE_ICONS = ['bean', 'coffee', 'heart', 'sun', 'sparkles', 'beaker', 'droplet', 'snowflake'] as const;
export type CoffeeIcon = typeof COFFEE_ICONS[number];
export interface BeanAppearancePatch {
  displayName?: string | null;
  shortcutLabel?: string | null;
  icon?: string | null;
  image?: string | null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Older custom builds kept appearance on bags. Resolve one coffee-wide fallback. */
export function beanAppearance(bean: Partial<Bean>, batches: readonly BeanBatch[] = []): Record<string, unknown> {
  const legacy = [...batches].sort((a, b) =>
    (Date.parse(b.updatedAt ?? b.roastDate ?? '') || 0) - (Date.parse(a.updatedAt ?? a.roastDate ?? '') || 0)
  ).find((batch) => Object.keys(record(batch.extras?.beanie)).length > 0);
  return { ...record(legacy?.extras?.beanie), ...record(bean.extras?.beanie) };
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function beanDisplayName(bean: Partial<Bean>, batches: readonly BeanBatch[] = []): string | null {
  return text(beanAppearance(bean, batches).displayName);
}

export function beanShortcutLabel(bean: Partial<Bean>, batches: readonly BeanBatch[] = []): string | null {
  return text(beanAppearance(bean, batches).shortcutLabel);
}

export function beanIcon(bean: Bean, batches: readonly BeanBatch[] = []): CoffeeIcon {
  const selected = beanAppearance(bean, batches).icon;
  if (COFFEE_ICONS.includes(selected as CoffeeIcon)) return selected as CoffeeIcon;
  const hash = [...bean.id].reduce((value, ch) => (value * 31 + ch.charCodeAt(0)) >>> 0, 0);
  return COFFEE_ICONS[hash % COFFEE_ICONS.length]!;
}

export function beanImage(bean: Partial<Bean>, batches: readonly BeanBatch[] = []): string | null {
  const image = beanAppearance(bean, batches).image;
  return typeof image === 'string' && /^data:image\/(?:jpeg|png|webp);base64,[a-zA-Z0-9+/=]+$/.test(image) && image.length <= 150_000 ? image : null;
}

export function beanAppearanceExtras(bean: Partial<Bean>, batches: readonly BeanBatch[], patch: BeanAppearancePatch): Record<string, unknown> {
  return { ...bean.extras, beanie: {
    ...record(bean.extras?.beanie),
    // Explicit defaults make clearing a field override legacy bag metadata.
    displayName: null, shortcutLabel: null, icon: null, image: null,
    ...beanAppearance(bean, batches), ...patch
  } };
}
