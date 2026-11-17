/** Own the icon selection in the uncontrolled, not-yet-saved coffee form. */
export function selectDraftCoffeeIcon(form: HTMLFormElement | null, chosen: string): void {
  if (!form) return;
  const input = form.elements.namedItem('coffeeIcon');
  const mode = form.elements.namedItem('appearanceMode');
  if (input instanceof HTMLInputElement) input.value = chosen;
  if (mode instanceof HTMLInputElement) mode.value = 'icon';
  for (const button of form.querySelectorAll<HTMLElement>('[data-action="choose-coffee-icon"]')) {
    button.setAttribute('aria-pressed', String(button.dataset.value === chosen));
  }
}
