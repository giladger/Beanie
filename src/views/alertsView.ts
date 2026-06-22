import { escapeHtml } from '../components/html';
import { icon } from '../components/icons';

export function renderNoScaleShotModal(blockEnabled: boolean): string {
  return `
    <div class="modal-backdrop no-scale-backdrop">
      <section class="modal panel no-scale-modal" role="alertdialog" aria-modal="true" aria-labelledby="no-scale-title">
        <div class="modal-head no-scale-head">
          <div>
            <h2 id="no-scale-title">Connect a scale to start</h2>
          </div>
          <button type="button" class="icon-button" data-action="close-modal" aria-label="Close">${icon('x')}</button>
        </div>
        <label class="no-scale-toggle-row">
          <span>
            <strong>Block shots without a scale</strong>
            <small>Turn this off to allow shots without a connected scale.</small>
          </span>
          <span class="settings-toggle">
            <input type="checkbox" data-action="no-scale-block-toggle" ${blockEnabled ? 'checked' : ''} />
            <span></span>
          </span>
        </label>
        <div class="modal-actions no-scale-actions">
          <button type="button" class="command primary no-scale-ok" data-action="close-modal">OK</button>
        </div>
      </section>
    </div>
  `;
}

export function renderDeleteProfileModal(title: string): string {
  return `
    <div class="modal-backdrop delete-shot-backdrop">
      <section class="modal panel delete-shot-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-profile-title">
        <div class="modal-head delete-shot-head">
          <div>
            <h2 id="delete-profile-title">Delete “${escapeHtml(title)}”?</h2>
          </div>
          <button type="button" class="icon-button" data-action="close-modal" aria-label="Close">${icon('x')}</button>
        </div>
        <p class="delete-shot-detail">This can’t be undone. You can hide it instead.</p>
        <div class="modal-actions delete-profile-actions">
          <button type="button" class="command" data-action="close-modal">Cancel</button>
          <button type="button" class="command" data-action="hide-instead-delete"><span>Hide instead</span></button>
          <button type="button" class="command danger" data-action="confirm-delete-profile">${icon('trash-2')}<span>Delete</span></button>
        </div>
      </section>
    </div>
  `;
}

export function renderDeleteShotModal(
  reclaim: { dose: string; remaining: string; next: string } | null
): string {
  const reclaimAction = reclaim
    ? `<button type="button" class="command primary" data-action="confirm-delete-shot-reclaim">Delete &amp; reclaim ${escapeHtml(reclaim.dose)}</button>`
    : '';
  const reclaimNote = reclaim
    ? `<p class="delete-shot-reclaim">Reclaim returns ${escapeHtml(reclaim.dose)} to the bag (${escapeHtml(reclaim.remaining)} → ${escapeHtml(reclaim.next)}).</p>`
    : '';
  return `
    <div class="modal-backdrop delete-shot-backdrop">
      <section class="modal panel delete-shot-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-shot-title">
        <div class="modal-head delete-shot-head">
          <div>
            <h2 id="delete-shot-title">Delete this shot?</h2>
          </div>
          <button type="button" class="icon-button" data-action="close-modal" aria-label="Close">${icon('x')}</button>
        </div>
        <p class="delete-shot-detail">This action cannot be undone.</p>
        ${reclaimNote}
        <div class="modal-actions delete-shot-actions">
          ${reclaimAction}
          <button type="button" class="command danger" data-action="confirm-delete-shot">${reclaim ? 'Delete without reclaiming' : 'Delete'}</button>
          <button type="button" class="command" data-action="close-modal">Cancel</button>
        </div>
      </section>
    </div>
  `;
}

export function renderWaterWarningBanner(mlLabel: string | null): string {
  return `
    <div class="water-warning-banner" role="status">
      ${icon('droplet')}
      <strong>Low water</strong>
      <span>${mlLabel ? `About ${escapeHtml(mlLabel)} left · refill soon` : 'Refill soon'}</span>
    </div>
  `;
}

export function renderWaterAlert(input: { machineBlocked: boolean; mlLabel: string | null }): string {
  const detail = input.machineBlocked
    ? 'The machine has paused shots until the tank is refilled.'
    : 'The tank is low — refill it to keep pulling shots.';
  return `
    <div class="modal-backdrop water-alert-backdrop" role="alertdialog" aria-modal="true" aria-labelledby="water-alert-title">
      <section class="modal panel water-alert-modal">
        <div class="water-alert-icon">${icon('droplet')}</div>
        <h2 id="water-alert-title">Refill the water tank</h2>
        <p>${escapeHtml(detail)}${input.mlLabel ? ` Tank is at about ${escapeHtml(input.mlLabel)}.` : ''}</p>
        <div class="modal-actions water-alert-actions">
          <button type="button" class="secondary-button" data-action="open-settings">Alert settings</button>
          <button type="button" class="primary-button" data-action="water-alert-dismiss">Dismiss</button>
        </div>
      </section>
    </div>
  `;
}
