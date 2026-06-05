// UI field specs for configurable gateway plugins. The gateway owns the actual
// values (see api/settings.ts); this file just describes how to render and label
// each plugin's settings form. Add a plugin here to expose its config in beanie.

import type { PluginSettings } from '../api/settings';

export type PluginSettingType = 'text' | 'password' | 'toggle' | 'select' | 'number';

export interface PluginSettingOption {
  value: string;
  label: string;
}

export interface PluginSettingField {
  key: string;
  label: string;
  type: PluginSettingType;
  help?: string;
  placeholder?: string;
  /** Sensitive in the UI: keep the field blank after save unless the user is editing it. */
  secret?: boolean;
  options?: PluginSettingOption[];
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  /** Fallback shown before the gateway supplies a value (matches the plugin's manifest default). */
  default?: string | number | boolean;
}

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
      { key: 'Username', label: 'Email', type: 'text', placeholder: 'you@example.com' },
      {
        key: 'Password',
        label: 'Password',
        type: 'password',
        secret: true,
        help: 'Leave blank to keep the saved password.'
      },
      { key: 'AutoUpload', label: 'Auto-upload after each shot', type: 'toggle' },
      {
        key: 'LengthThreshold',
        label: 'Minimum shot length to upload',
        type: 'number',
        min: 0,
        max: 120,
        step: 1,
        unit: 's',
        help: 'Skip uploading very short flushes and rinses.'
      },
      {
        key: 'BackSync',
        label: 'Sync edits back from Visualizer',
        type: 'toggle',
        help: 'Pull notes, TDS, EY, enjoyment and bean/grinder you edit on visualizer.coffee back onto your shots. Only your own uploaded shots are touched.'
      },
      {
        key: 'BackSyncIntervalSeconds',
        label: 'Back-sync check interval',
        type: 'number',
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
  settings: PluginSettings;
  draft: Record<string, string | number | boolean>;
  /** Secret fields the user actually typed into this session (only these get sent). */
  secretEdited: Record<string, boolean>;
  dirty: boolean;
  saving: boolean;
  verify: { tone: PluginVerifyTone; message: string } | null;
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
