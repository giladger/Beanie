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

window.__beanieApp?.dispose();

const app = new BeanieApp(root);
window.__beanieApp = app;
app.start();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    app.dispose();
    if (window.__beanieApp === app) delete window.__beanieApp;
  });
}
