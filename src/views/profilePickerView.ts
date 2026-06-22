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
          ${
            sorted.length === 0
              ? '<p class="empty">No profiles match.</p>'
              : renderProfileRows(sorted, favorites, model.selectedId, focus?.id ?? null)
          }
          ${cleaningMode || !model.showHidden ? '' : renderHiddenSection(model)}
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
  const records = [...model.profiles].sort((a, b) =>
    profileShortTitle(a.profile.title ?? a.id).localeCompare(
      profileShortTitle(b.profile.title ?? b.id),
      undefined,
      { sensitivity: 'base' }
    )
  );
  return `
    ${profilePageHeader(model.cleaningMode ? 'Cleaning profile' : 'Profiles', model.cleaningMode ? 'machine' : 'workbench', '')}
    <main class="page-body phone-profiles-page">
      <div class="phone-profile-list">
        ${
          records.length === 0
            ? '<p class="empty">No profiles.</p>'
            : records.map((record) => {
                const title = profileShortTitle(record.profile.title ?? record.id);
                return `
                  <button type="button" class="phone-profile-title ${record.id === selectedId ? 'active' : ''}" data-action="pick-profile" data-id="${escapeAttr(record.id)}">
                    ${escapeHtml(title)}
                  </button>
                `;
              }).join('')
        }
      </div>
    </main>
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
  focusId: string | null
): string {
  let lastGroup = '';
  return records.map((record) => {
    const group = profileGroupLabel(record, favorites);
    const header = group !== lastGroup ? `<div class="profile-group-header">${escapeHtml(group)}</div>` : '';
    lastGroup = group;
    return `${header}${renderProfileRow(record, favorites.has(record.id), record.id === selectedId, record.id === focusId)}`;
  }).join('');
}

function renderProfileRow(record: ProfileRecord, favorite: boolean, active: boolean, focused = false): string {
  const title = record.profile.title ?? record.id;
  const shortTitle = profileShortTitle(title);
  return `
    <div class="profile-row ${active ? 'active' : ''} ${focused ? 'focused' : ''}">
      <button type="button" class="profile-pick" data-action="focus-profile" data-id="${escapeAttr(record.id)}">
        <span class="profile-row-title">${favorite ? '<span class="profile-row-fav">★</span> ' : ''}${escapeHtml(shortTitle)}</span>
      </button>
      ${active ? '<span class="profile-selected-dot">Selected</span>' : ''}
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
        ${cleaningMode ? '' : `<button type="button" class="pa-edit pa-hide" data-action="hide-profile" data-id="${escapeAttr(record.id)}"><span>Hide</span></button>`}
        ${cleaningMode || record.isDefault ? '' : renderDeleteButton(record.id)}
        <button type="button" class="pa-edit" data-action="edit-profile" data-id="${escapeAttr(record.id)}">${icon('pencil')}<span>Edit</span></button>
        <button type="button" class="pa-select ${active ? 'is-selected' : ''}" data-action="pick-profile" data-id="${escapeAttr(record.id)}">Select</button>
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
    <div class="profile-group-header">Hidden</div>
    ${rows}
  `;
}

function renderHiddenRow(record: ProfileRecord): string {
  const title = profileShortTitle(record.profile.title ?? record.id);
  return `
    <div class="profile-row profile-row-hidden">
      <span class="profile-row-title">${escapeHtml(title)}</span>
      <div class="profile-row-actions">
        <button type="button" class="pa-edit pa-unhide" data-action="unhide-profile" data-id="${escapeAttr(record.id)}"><span>Unhide</span></button>
        ${record.isDefault ? '' : renderDeleteButton(record.id)}
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
