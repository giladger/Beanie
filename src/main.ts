import { BeanieApp } from './app';
import './styles.css';

declare global {
  interface Window {
    __beanieApp?: BeanieApp;
  }
}

const root = document.getElementById('app');

if (!root) {
  throw new Error('Beanie root element was not found');
}

let app: BeanieApp | null = null;
let bootstrapCanceled = false;
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    bootstrapCanceled = true;
    const owned = app;
    if (!owned) return;
    void owned.disposeAsync().finally(() => {
      if (window.__beanieApp === owned) delete window.__beanieApp;
    });
  });
}

async function bootstrap(): Promise<void> {
  const previous = window.__beanieApp;
  if (previous) await previous.disposeAsync();
  if (bootstrapCanceled) return;
  const next = new BeanieApp(root!);
  app = next;
  window.__beanieApp = next;
  next.start();
}

void bootstrap().catch((error) => {
  console.error('[Beanie] Bootstrap failed', error);
});
