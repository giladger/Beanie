import type { ProfileRecord } from '../api/types';
import { createProfileEditorState } from '../components/profileEditor';
import { renderProfilePreview } from '../components/profilePreview';
import { escapeAttr, escapeHtml } from '../components/html';
import { icon } from '../components/icons';

export interface ProfilePickerViewModel {
  profiles: ProfileRecord[];
  search: string;
  favoriteProfileIds: readonly string[];
  selectedId: string | null;
  focusId: string | null;
  cleaningMode: boolean;
  showHidden: boolean;
  hiddenProfiles: readonly ProfileRecord[];
  /** While true (the first several loads), an armed row teaches the gesture with
   *  the floating "Tap again to load" tooltip instead of the plain pill. */
  showLoadHint?: boolean;
}

export function renderProfilesPage(model: ProfilePickerViewModel): string {
  const cleaningMode = model.cleaningMode;
  const query = model.search.trim().toLowerCase();
  const favorites = new Set(model.favoriteProfileIds);
  const matches = model.profiles.filter((record) => {
    const title = (record.profile.title ?? '').toLowerCase();
    const author = (record.profile.author ?? '').toLowerCase();
    return !query || title.includes(query) || author.includes(query);
  });
  const sorted = [...matches].sort((a, b) => {
    const fa = favorites.has(a.id) ? 0 : 1;
    const fb = favorites.has(b.id) ? 0 : 1;
    if (fa !== fb) return fa - fb;
    const ga = profileGroupLabel(a, favorites);
    const gb = profileGroupLabel(b, favorites);
    if (ga !== gb) return ga.localeCompare(gb, undefined, { sensitivity: 'base' });
    return profileShortTitle(a.profile.title ?? a.id).localeCompare(
      profileShortTitle(b.profile.title ?? b.id),
      undefined,
      { sensitivity: 'base' }
    );
  });
  const focus =
    sorted.find((record) => record.id === model.focusId) ??
    sorted.find((record) => record.id === model.selectedId) ??
    sorted[0] ??
    null;
  const showHiddenLabel = model.showHidden ? 'Hide hidden profiles' : 'Show hidden profiles';
  const actions = cleaningMode
    ? ''
    : `<button class="icon-button eye-toggle ${model.showHidden ? 'on' : ''}" data-action="toggle-show-hidden" aria-label="${showHiddenLabel}" title="${showHiddenLabel}" aria-pressed="${model.showHidden}">${icon(model.showHidden ? 'eye' : 'eye-off')}</button>` +
      `<button class="icon-button" data-action="open-import-profile" aria-label="Import from Visualizer" title="Import from Visualizer">${icon('arrow-down')}</button>` +
      `<button class="icon-button" data-action="new-profile" aria-label="New profile" title="New profile">${icon('plus')}</button>`;

  return `
    ${profilePageHeader(cleaningMode ? 'Cleaning profile' : 'Profiles', cleaningMode ? 'machine' : 'workbench', actions)}
    <main class="page-body profiles-page no-scroll-page">
      <label class="search">
        ${icon('search')}
        <input type="search" data-action="profile-search" value="${escapeAttr(model.search)}" placeholder="Search profiles" />
      </label>
      <section class="profile-selector-shell">
        <div class="profile-list">
          ${cleaningMode || !model.showHidden ? '' : renderHiddenSection(model)}
          ${
            sorted.length === 0
              ? '<p class="empty">No profiles match.</p>'
              : renderProfileRows(sorted, favorites, model.selectedId, focus?.id ?? null, model.showLoadHint ?? false)
          }
        </div>
        ${renderProfilePreviewPane(focus, {
          favorite: favorites.has(focus?.id ?? ''),
          active: focus?.id === model.selectedId,
          cleaningMode
        })}
      </section>
    </main>
  `;
}

export function renderPhoneProfilesPage(model: ProfilePickerViewModel): string {
  const selectedId = model.selectedId;
  const query = model.search.trim().toLowerCase();
  const favorites = new Set(model.favoriteProfileIds);
  const matches = model.profiles.filter((record) => {
    if (!query) return true;
    const title = (record.profile.title ?? '').toLowerCase();
    const author = (record.profile.author ?? '').toLowerCase();
    return title.includes(query) || author.includes(query);
  });
  // Favourites first, then alphabetical — same ordering intent as the tablet picker.
  const records = matches.sort((a, b) => {
    const fa = favorites.has(a.id) ? 0 : 1;
    const fb = favorites.has(b.id) ? 0 : 1;
    if (fa !== fb) return fa - fb;
    return profileShortTitle(a.profile.title ?? a.id).localeCompare(
      profileShortTitle(b.profile.title ?? b.id),
      undefined,
      { sensitivity: 'base' }
    );
  });
  return `
    ${profilePageHeader(model.cleaningMode ? 'Cleaning profile' : 'Profiles', model.cleaningMode ? 'machine' : 'workbench', '')}
    <main class="page-body phone-profiles-page">
      <label class="search phone-profile-search">
        ${icon('search')}
        <input type="search" data-action="profile-search" value="${escapeAttr(model.search)}" placeholder="Search profiles" spellcheck="false" autocapitalize="none" autocorrect="off" />
      </label>
      <div class="phone-profile-list">
        ${
          records.length === 0
            ? `<p class="empty">${query ? 'No profiles match.' : 'No profiles.'}</p>`
            : records.map((record) => renderPhoneProfileRow(record, record.id === selectedId, favorites.has(record.id))).join('')
        }
      </div>
    </main>
  `;
}

function renderPhoneProfileRow(record: ProfileRecord, active: boolean, favorite: boolean): string {
  const title = profileShortTitle(record.profile.title ?? record.id);
  // reaprime drops `type`, so derive the real kind from the steps (same as the preview pane).
  const type = createProfileEditorState(record.profile).type;
  const meta = [displayProfileType(type), record.profile.author?.trim()].filter(Boolean).join(' · ');
  return `
    <button type="button" class="phone-profile-title ${active ? 'active' : ''}" data-action="pick-profile" data-id="${escapeAttr(record.id)}">
      <span class="phone-profile-name">${favorite ? '<span class="phone-row-fav">★</span> ' : ''}${escapeHtml(title)}</span>
      ${meta ? `<span class="phone-profile-meta">${escapeHtml(meta)}</span>` : ''}
    </button>
  `;
}

function profilePageHeader(title: string, back: string, actions: string): string {
  return `
    <header class="page-head">
      <button class="page-back" data-action="go-view" data-value="${escapeAttr(back)}" aria-label="Back" title="Back">
        ${icon('chevron-left')}<span>Back</span>
      </button>
      <h1 class="page-title">${escapeHtml(title)}</h1>
      <div class="page-head-actions">${actions}</div>
    </header>
  `;
}

// Group key for the picker: favorites cluster first, otherwise group by the
// title's folder prefix (e.g. "A-Flow/...") or, lacking one, by author.
export function profileGroupLabel(record: ProfileRecord, favorites: Set<string>): string {
  if (favorites.has(record.id)) return 'Favorites';
  return profileGroup(record.profile.title ?? record.id, record.profile.author);
}

function renderProfileRows(
  records: ProfileRecord[],
  favorites: Set<string>,
  selectedId: string | null,
  focusId: string | null,
  showLoadHint: boolean
): string {
  let lastGroup = '';
  return records.map((record) => {
    const group = profileGroupLabel(record, favorites);
    const header = group !== lastGroup ? `<div class="profile-group-header">${escapeHtml(group)}</div>` : '';
    lastGroup = group;
    return `${header}${renderProfileRow(record, favorites.has(record.id), record.id === selectedId, record.id === focusId, showLoadHint)}`;
  }).join('');
}

// Selection mirrors the bean picker: the first tap focuses a row (previewing it
// in the pane), and a second tap on the focused row loads it. An armed row shows
// a "Tap again" affordance — while the gesture is still being learned that's the
// floating suggestion tooltip, and afterwards the quieter inline pill. This is
// driven purely by the armed state, so it reads the same however the row got
// focused (list tap, or returning from the editor after a save).
function renderProfileRow(
  record: ProfileRecord,
  favorite: boolean,
  active: boolean,
  focused = false,
  showLoadHint = false
): string {
  const title = record.profile.title ?? record.id;
  const shortTitle = profileShortTitle(title);
  const armed = focused && !active;
  const tooltip = armed && showLoadHint;
  const status = active ? 'Selected' : armed && !tooltip ? 'Tap again' : '';
  return `
    <div id="profile-${escapeAttr(record.id)}" class="profile-row ${active ? 'active' : ''} ${focused ? 'focused' : ''} ${tooltip ? 'has-second-tap-hint' : ''}">
      <button type="button" class="profile-pick" data-action="focus-profile" data-id="${escapeAttr(record.id)}">
        <span class="profile-row-title">${favorite ? '<span class="profile-row-fav">★</span> ' : ''}${escapeHtml(shortTitle)}</span>
      </button>
      ${status ? `<span class="profile-row-action ${active ? 'current' : 'armed'}">${escapeHtml(status)}</span>` : ''}
      ${tooltip ? '<span class="second-tap-tooltip">Tap again to load</span>' : ''}
    </div>
  `;
}

function renderProfilePreviewPane(
  record: ProfileRecord | null,
  options: { favorite: boolean; active: boolean; cleaningMode: boolean }
): string {
  const { favorite, active, cleaningMode } = options;
  if (!record) {
    return `
      <aside class="profile-preview-pane">
        <p class="empty">No profile selected.</p>
      </aside>
    `;
  }
  const title = record.profile.title ?? record.id;
  const author = record.profile.author ?? '';
  // reaprime drops `type`, so derive the real kind from the steps.
  const type = createProfileEditorState(record.profile).type;
  return `
    <aside class="profile-preview-pane">
      <div class="profile-preview-head">
        <div>
          <span class="eyebrow">${escapeHtml(author || 'Profile')}</span>
          <h2>${escapeHtml(title)}</h2>
          <span class="profile-type-chip">${escapeHtml(displayProfileType(type))}</span>
        </div>
        <button type="button" class="profile-fav ${favorite ? 'on' : ''}" data-action="toggle-favorite-profile" data-id="${escapeAttr(record.id)}" aria-label="${favorite ? 'Unfavorite' : 'Favorite'} ${escapeAttr(title)}" aria-pressed="${favorite}">${favorite ? '★' : '☆'}</button>
      </div>
      <section class="profile-preview-block">
        <span class="eyebrow">Preview</span>
        <div class="profile-preview-large">
          ${renderProfilePreview(record.profile)}
        </div>
      </section>
      <section class="profile-description-block">
        <span class="eyebrow">Description</span>
        <p class="profile-preview-notes">${escapeHtml(record.profile.notes || 'No description.')}</p>
      </section>
      <div class="profile-preview-actions">
        <span class="profile-preview-select-hint ${active ? 'is-loaded' : ''}">${active ? 'Loaded' : 'Tap the profile again to load it'}</span>
        ${cleaningMode ? '' : `<button type="button" class="pa-edit pa-hide" data-action="hide-profile" data-id="${escapeAttr(record.id)}"><span>Hide</span></button>`}
        ${cleaningMode || record.isDefault ? '' : renderDeleteButton(record.id)}
        <button type="button" class="pa-edit" data-action="edit-profile" data-id="${escapeAttr(record.id)}">${icon('pencil')}<span>Edit</span></button>
      </div>
    </aside>
  `;
}

// The hidden-profiles section, shown when the "Show hidden profiles" toggle is
// on: each hidden profile (defaults included) gets Unhide and — for user
// profiles — Delete. The reveal toggle itself lives under the search bar.
function renderHiddenSection(model: ProfilePickerViewModel): string {
  const hidden = [...model.hiddenProfiles].sort((a, b) =>
    profileShortTitle(a.profile.title ?? a.id).localeCompare(
      profileShortTitle(b.profile.title ?? b.id),
      undefined,
      { sensitivity: 'base' }
    )
  );
  const rows =
    hidden.length === 0
      ? '<p class="empty">No hidden profiles.</p>'
      : hidden.map((record) => renderHiddenRow(record)).join('');
  return `
    <div class="profile-hidden-section">
      <div class="profile-group-header">Hidden</div>
      ${rows}
    </div>
  `;
}

function renderHiddenRow(record: ProfileRecord): string {
  const title = profileShortTitle(record.profile.title ?? record.id);
  return `
    <div id="profile-hidden-${escapeAttr(record.id)}" class="profile-row profile-row-hidden">
      <span class="profile-row-title">${escapeHtml(title)}</span>
      <div class="profile-row-actions">
        ${record.isDefault ? '' : renderDeleteButton(record.id)}
        <button type="button" class="pa-edit pa-unhide" data-action="unhide-profile" data-id="${escapeAttr(record.id)}"><span>Unhide</span></button>
      </div>
    </div>
  `;
}

// Delete opens a confirmation dialog (the action can't be undone), so this is
// just a plain trigger.
function renderDeleteButton(id: string): string {
  return `<button type="button" class="pa-edit pa-delete" data-action="delete-profile" data-id="${escapeAttr(id)}">${icon('trash-2')}<span>Delete</span></button>`;
}

function profileGroup(title: string, author?: string): string {
  const slash = title.indexOf('/');
  if (slash > 0) return title.slice(0, slash).trim();
  return author?.trim() || 'Profiles';
}

export function profileShortTitle(title: string): string {
  const slash = title.indexOf('/');
  return slash > 0 ? title.slice(slash + 1).trim() : title;
}

export function displayProfileType(value: string): string {
  const legacy =
    value === 'settings_2a'
      ? 'pressure'
      : value === 'settings_2b'
        ? 'flow'
        : value === 'settings_2c' || value === 'settings_2c2'
          ? 'advanced'
          : value;
  return legacy.charAt(0).toUpperCase() + legacy.slice(1);
}
