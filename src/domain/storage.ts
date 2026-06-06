const lastBeanKey = 'beanie:last-bean-id';

export function readLastBeanId(): string | null {
  return localStorage.getItem(lastBeanKey);
}

export function writeLastBeanId(beanId: string): void {
  localStorage.setItem(lastBeanKey, beanId);
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
