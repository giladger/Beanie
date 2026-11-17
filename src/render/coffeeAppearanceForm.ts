/** Own the icon selection in the uncontrolled, not-yet-saved coffee form. */
export function selectDraftCoffeeIcon(form: HTMLFormElement | null, chosen: string): void {
  if (!form) return;
  const input = form.elements.namedItem('coffeeIcon');
  const mode = form.elements.namedItem('appearanceMode');
  if (input instanceof HTMLInputElement) input.value = chosen;
  if (mode instanceof HTMLInputElement) mode.value = 'icon';
  syncDraftCoffeeIcon(form);
}

/** Hidden inputs reflect their value into defaultValue, so the normal dirty-text guard cannot preserve them. */
export function syncDraftCoffeeIcon(form: HTMLFormElement | null): void {
  if (!form) return;
  const input = form.elements.namedItem('coffeeIcon');
  const mode = form.elements.namedItem('appearanceMode');
  if (!(input instanceof HTMLInputElement)) return;
  input.dataset.morphSkip = 'draft-coffee-icon';
  if (mode instanceof HTMLInputElement) mode.dataset.morphSkip = 'draft-coffee-icon';
  const options = form.querySelector<HTMLElement>('.coffee-icon-options');
  if (options) options.dataset.morphSkip = 'draft-coffee-icon';
  for (const button of form.querySelectorAll<HTMLElement>('[data-action="choose-coffee-icon"]')) {
    button.setAttribute('aria-pressed', String(button.dataset.value === input.value));
  }
}
