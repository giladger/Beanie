import { escapeHtml } from '../components/html';
import { morphRender } from './renderer';

export function bootstrapFailureMarkup(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `
    <main class="bootstrap-failure" role="alert">
      <section class="bootstrap-failure-card">
        <p class="eyebrow">Beanie could not start</p>
        <h1>Something went wrong before the app loaded.</h1>
        <p>Reload to try again. If this keeps happening, open the browser console and include the error below in a bug report.</p>
        <button type="button" data-action="bootstrap-reload">Reload Beanie</button>
        <details><summary>Technical detail</summary><code>${escapeHtml(detail)}</code></details>
      </section>
    </main>`;
}

export function renderBootstrapFailure(root: HTMLElement, error: unknown): void {
  morphRender(root, bootstrapFailureMarkup(error));
}
