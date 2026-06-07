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

// The user's own (free-tier) Gemini key for the AI label scanner. Phase 1 keeps
// it in localStorage on this device; a shared/gateway home is a Phase 2 concern.
const geminiApiKeyKey = 'beanie:gemini-api-key';

export function readGeminiApiKey(): string | null {
  const value = localStorage.getItem(geminiApiKeyKey);
  return value && value.trim() ? value : null;
}

export function writeGeminiApiKey(key: string): void {
  const trimmed = key.trim();
  if (trimmed) localStorage.setItem(geminiApiKeyKey, trimmed);
  else localStorage.removeItem(geminiApiKeyKey);
}

export function clearGeminiApiKey(): void {
  localStorage.removeItem(geminiApiKeyKey);
}
