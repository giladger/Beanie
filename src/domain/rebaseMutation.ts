/**
 * Rebase a snapshot-derived edit onto the latest authoritative object.
 * Only fields changed from `base` are applied; untouched fields retain values
 * written by another serialized/background mutation in the meantime.
 */
export function rebaseChangedFields<Value extends object>(
  base: Value | null | undefined,
  desired: Value,
  latest: Value | null | undefined
): Value {
  if (!latest) return desired;
  const baseRecord = (base ?? {}) as Record<string, unknown>;
  const desiredRecord = desired as Record<string, unknown>;
  const result: Record<string, unknown> = { ...(latest as Record<string, unknown>) };
  for (const [key, value] of Object.entries(desiredRecord)) {
    if (!structurallyEqualValue(value, baseRecord[key])) result[key] = value;
  }
  return result as Value;
}

function structurallyEqualValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}
