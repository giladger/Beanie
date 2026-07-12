// UI field specs for configurable gateway plugins. The gateway owns the actual
// values (see api/settings.ts); this file just describes how to render and label
// each plugin's settings form. Add a plugin here to expose its config in beanie.

import type { PluginSettings, RawPluginSettings } from '../api/settings';

declare const sanitizedPluginSettingsBrand: unique symbol;

/** UI-safe settings: previously stored readable secret values have been removed. */
export type SanitizedPluginSettings = PluginSettings & {
  readonly [sanitizedPluginSettingsBrand]: true;
};

export type PluginSettingType = 'text' | 'password' | 'toggle' | 'select' | 'number';
type PublicPluginSettingType = Exclude<PluginSettingType, 'password'>;

export interface PluginSettingOption {
  value: string;
  label: string;
}

interface PluginSettingFieldBase {
  key: string;
  label: string;
  help?: string;
  placeholder?: string;
  options?: PluginSettingOption[];
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  /** Fallback shown before the gateway supplies a value (matches the plugin's manifest default). */
  default?: string | number | boolean;
}

/**
 * Every field declares sensitivity. Password renderers are structurally
 * write-only, so adding one without secret handling is a compile-time error.
 */
export type PluginSettingField = PluginSettingFieldBase & (
  | { type: 'password'; secret: true }
  | { type: PublicPluginSettingType; secret: false }
);

export interface PluginSettingsSpec {
  id: string;
  title: string;
  help?: string;
  /** Whether the gateway can test the saved credentials for this plugin. */
  supportsVerify?: boolean;
  fields: PluginSettingField[];
}

export const PLUGIN_SETTINGS_SPECS: Record<string, PluginSettingsSpec> = {
  visualizer: {
    id: 'visualizer',
    title: 'Visualizer',
    help: 'Upload finished shots to visualizer.coffee, and optionally sync your edits back. Credentials are stored by the gateway and hidden here after saving.',
    supportsVerify: true,
    fields: [
      { key: 'Username', label: 'Email', type: 'text', secret: false, placeholder: 'you@example.com' },
      {
        key: 'Password',
        label: 'Password',
        type: 'password',
        secret: true,
        help: 'Leave blank to keep the saved password.'
      },
      { key: 'AutoUpload', label: 'Auto-upload after each shot', type: 'toggle', secret: false, default: true },
      {
        key: 'LengthThreshold',
        label: 'Minimum shot length to upload',
        type: 'number',
        secret: false,
        min: 0,
        max: 120,
        step: 1,
        unit: 's',
        default: 5,
        help: 'Skip uploading very short flushes and rinses.'
      },
      {
        key: 'BackSync',
        label: 'Sync edits back from Visualizer',
        type: 'toggle',
        secret: false,
        help: 'Pull notes, TDS, EY, enjoyment and bean/grinder you edit on visualizer.coffee back onto your shots. Only your own uploaded shots are touched.'
      },
      {
        key: 'BackSyncIntervalSeconds',
        label: 'Back-sync check interval',
        type: 'number',
        secret: false,
        min: 60,
        max: 3600,
        step: 60,
        unit: 's',
        default: 300,
        help: 'How often to check Visualizer for your edits.'
      }
    ]
  }
};

// Gateway plugin ids carry a `.reaplugin` suffix (e.g. "visualizer.reaplugin"),
// while specs are keyed by the bare name — normalize before looking up.
export function normalizePluginId(id: string): string {
  return id.replace(/\.reaplugin$/i, '').toLowerCase();
}

export function pluginSettingsSpec(id: string): PluginSettingsSpec | null {
  return PLUGIN_SETTINGS_SPECS[normalizePluginId(id)] ?? null;
}

export type PluginVerifyTone = 'good' | 'warn' | 'muted';

// Transient editor state for the currently-open plugin config panel.
export interface PluginConfigState {
  id: string;
  /** Identifies one open panel session so late saves cannot resurrect a reopened panel. */
  session: number;
  /** Advances with draft intent and fences save settlement across later edits. */
  revision: number;
  settings: SanitizedPluginSettings;
  draft: Record<string, string | number | boolean>;
  /** Fields intentionally changed in this panel session. */
  touched: Record<string, boolean>;
  /** Per-field intent ownership; preserves later A→B→A edits during settlement. */
  fieldRevisions: Record<string, number>;
  /** Secret fields the user actually typed into this session (only these get sent). */
  secretEdited: Record<string, boolean>;
  dirty: boolean;
  saving: boolean;
  verify: { tone: PluginVerifyTone; message: string } | null;
}

export interface PluginSettingsSavePlan {
  readonly id: string;
  readonly session: number;
  readonly revision: number;
  /** Local changes only; the mutation adapter rebases them on a fresh gateway read. */
  payload: Record<string, string | number | boolean>;
  /** Per-field revisions captured with the submitted draft. */
  submittedFieldRevisions: Record<string, number>;
  /** Safe fallback snapshot after acceptance; secret plaintext is never retained. */
  settings: SanitizedPluginSettings;
}

/**
 * Build a local-change patch without treating a blank password field as new
 * secret intent. The gateway adapter rebases this patch inside the per-plugin
 * mutation lane, so unrelated remote values are not overwritten.
 */
export function buildPluginSettingsSavePlan(
  config: PluginConfigState
): PluginSettingsSavePlan | null {
  const spec = pluginSettingsSpec(config.id);
  if (!spec) return null;
  const payload: Record<string, string | number | boolean> = {};
  const submittedFieldRevisions: Record<string, number> = {};
  const safeSettings = sanitizePluginSettings(config.id, config.settings);
  const values = { ...safeSettings.values };
  const secretsSet = { ...safeSettings.secretsSet };

  for (const field of spec.fields) {
    const draftValue = config.draft[field.key] ?? pluginFieldDefault(field);
    if (config.touched[field.key] || config.secretEdited[field.key]) {
      submittedFieldRevisions[field.key] = config.fieldRevisions[field.key] ?? config.revision;
    }
    if (field.secret) {
      if (config.secretEdited[field.key] && String(draftValue) !== '') {
        payload[field.key] = draftValue;
        secretsSet[field.key] = true;
      }
      delete values[field.key];
      continue;
    }
    if (config.touched[field.key] && !Object.is(draftValue, safeSettings.values[field.key])) {
      payload[field.key] = draftValue;
      values[field.key] = draftValue;
    }
  }

  return {
    id: config.id,
    session: config.session,
    revision: config.revision,
    payload,
    submittedFieldRevisions,
    settings: sanitizePluginSettings(config.id, { values, secretsSet })
  };
}

export function sanitizePluginSettings(
  id: string,
  settings: PluginSettings
): SanitizedPluginSettings {
  const spec = pluginSettingsSpec(id);
  const values: Record<string, string | number | boolean> = {};
  const secretsSet: Record<string, boolean> = {};
  for (const field of spec?.fields ?? []) {
    if (field.secret) {
      const readable = settings.values[field.key];
      secretsSet[field.key] = settings.secretsSet[field.key] === true ||
        (readable != null && String(readable) !== '');
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(settings.values, field.key)) {
      values[field.key] = settings.values[field.key]!;
    }
  }
  return { values, secretsSet } as SanitizedPluginSettings;
}

export function rebasePluginSettingsPayload(
  current: RawPluginSettings,
  changes: Readonly<Record<string, string | number | boolean>>
): Record<string, string | number | boolean> {
  // Reaprime replaces the entire stored map. Its fresh response is kept only
  // in this mutation-lane closure, so preserve every raw value (including a
  // visually write-only credential) and sanitize only when crossing into UI state.
  return { ...current.values, ...changes };
}

export function createPluginConfigState(
  id: string,
  settings: PluginSettings,
  session: number
): PluginConfigState {
  const safeSettings = sanitizePluginSettings(id, settings);
  const draft: Record<string, string | number | boolean> = {};
  for (const field of pluginSettingsSpec(id)?.fields ?? []) {
    draft[field.key] = field.secret
      ? ''
      : safeSettings.values[field.key] ?? pluginFieldDefault(field);
  }
  return {
    id,
    session,
    revision: 0,
    settings: safeSettings,
    draft,
    touched: {},
    fieldRevisions: {},
    secretEdited: {},
    dirty: false,
    saving: false,
    verify: null
  };
}

export function settlePluginSettingsSave(
  current: PluginConfigState | null,
  plan: PluginSettingsSavePlan,
  result: { readonly ok: boolean; readonly settings?: PluginSettings | null }
): PluginConfigState | null {
  if (
    !current ||
    normalizePluginId(current.id) !== normalizePluginId(plan.id) ||
    current.session !== plan.session
  ) return current;

  if (!result.ok) {
    return {
      ...current,
      saving: false,
      verify: { tone: 'warn', message: 'Save failed. Check plugin settings are valid.' }
    };
  }

  const accepted = sanitizePluginSettings(plan.id, result.settings ?? plan.settings);
  if (current.revision === plan.revision) {
    return createPluginConfigState(current.id, accepted, current.session);
  }
  const draft = { ...current.draft };
  const touched = { ...current.touched };
  const fieldRevisions = { ...current.fieldRevisions };
  const secretEdited = { ...current.secretEdited };
  for (const field of pluginSettingsSpec(plan.id)?.fields ?? []) {
    const submittedRevision = plan.submittedFieldRevisions[field.key] ?? 0;
    const hasLaterIntent = (current.fieldRevisions[field.key] ?? 0) > submittedRevision;
    if (hasLaterIntent) continue;
    delete touched[field.key];
    delete fieldRevisions[field.key];
    if (field.secret) {
      if (Object.prototype.hasOwnProperty.call(plan.payload, field.key)) {
        draft[field.key] = '';
        delete secretEdited[field.key];
      }
      continue;
    }
    draft[field.key] = accepted.values[field.key] ?? pluginFieldDefault(field);
  }
  const dirty = Object.values(touched).some(Boolean) || Object.values(secretEdited).some(Boolean);
  return {
    ...current,
    settings: accepted,
    draft,
    touched,
    fieldRevisions,
    secretEdited,
    saving: false,
    dirty
  };
}

/** Default value for a field when the gateway hasn't supplied one yet. */
export function pluginFieldDefault(field: PluginSettingField): string | number | boolean {
  if (field.secret) return '';
  if (field.default !== undefined) return field.default;
  switch (field.type) {
    case 'toggle':
      return false;
    case 'number':
      return field.min ?? 0;
    case 'select':
      return field.options?.[0]?.value ?? '';
    default:
      return '';
  }
}
