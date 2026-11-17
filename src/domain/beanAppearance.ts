import type { Bean, BeanBatch } from '../api/types';

export const COFFEE_ICONS = ['bean', 'coffee', 'heart', 'star', 'sun', 'moon', 'leaf', 'flower-2', 'tree-pine', 'mountain', 'flame', 'snowflake', 'droplet', 'waves', 'cherry', 'apple', 'citrus', 'cookie', 'croissant', 'cake-slice', 'beaker', 'rocket', 'rainbow', 'smile', 'sparkles'] as const;
export type CoffeeIcon = typeof COFFEE_ICONS[number];
export interface BeanAppearancePatch {
  displayName?: string | null;
  icon?: string | null;
  image?: string | null;
  appearanceMode?: 'icon' | 'photo';
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

export function automaticCoffeeIcon(beanId: string, favorite = false): CoffeeIcon {
  if (favorite) return 'heart';
  const choices = COFFEE_ICONS.filter((name) => name !== 'heart');
  const hash = [...beanId].reduce((value, ch) => (value * 31 + ch.charCodeAt(0)) >>> 0, 0);
  return choices[hash % choices.length]!;
}

export function coffeeIconLabel(name: CoffeeIcon): string {
  const labels: Partial<Record<CoffeeIcon, string>> = { 'flower-2': 'Flower', 'tree-pine': 'Pine tree', 'cake-slice': 'Cake' };
  return labels[name] ?? name.charAt(0).toUpperCase() + name.slice(1);
}

export function beanIcon(bean: Bean, batches: readonly BeanBatch[] = [], favorite = false): CoffeeIcon {
  const selected = beanAppearance(bean, batches).icon;
  if (COFFEE_ICONS.includes(selected as CoffeeIcon)) return selected as CoffeeIcon;
  return automaticCoffeeIcon(bean.id, favorite);
}

export function beanImage(bean: Partial<Bean>, batches: readonly BeanBatch[] = []): string | null {
  if (beanAppearance(bean, batches).appearanceMode === 'icon') return null;
  return beanSavedImage(bean, batches);
}

export function beanSavedImage(bean: Partial<Bean>, batches: readonly BeanBatch[] = []): string | null {
  const image = beanAppearance(bean, batches).image;
  return typeof image === 'string' && /^data:image\/(?:jpeg|png|webp);base64,[a-zA-Z0-9+/=]+$/.test(image) && image.length <= 150_000 ? image : null;
}

export function beanAppearanceExtras(bean: Partial<Bean>, batches: readonly BeanBatch[], patch: BeanAppearancePatch): Record<string, unknown> {
  const appearance = beanAppearance(bean, batches);
  delete appearance.shortcutLabel;
  return { ...bean.extras, beanie: {
    // Explicit defaults make clearing a field override legacy bag metadata.
    displayName: null, icon: null, image: null,
    ...appearance, ...patch
  } };
}
