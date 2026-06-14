import { BeanieApp } from './app';
import { detectDecentAppWebView, isDecentAppWebView } from './appShell';
import './styles.css';

declare global {
  interface Window {
    __beanieApp?: BeanieApp;
  }
}

// TEMP DEBUG: surface webview-detection signals on screen, hidden until you tap
// the topbar Status value 10 times. Remove before release.
function showWebViewDetectionDebug(): void {
  if (document.getElementById('rea-detect-debug')) return;

  const win = window as { __REA_HOST__?: unknown; flutter_inappwebview?: unknown };
  const reaHost = win.__REA_HOST__;
  const hasBridge = win.flutter_inappwebview != null;
  const ua = navigator.userAgent;
  const box = document.createElement('div');
  box.id = 'rea-detect-debug';
  box.style.cssText =
    'position:fixed;left:8px;bottom:8px;z-index:99999;max-width:90vw;display:none;' +
    'background:rgba(0,0,0,.85);color:#0f0;font:12px/1.4 monospace;' +
    'padding:8px 10px;border:1px solid #0f0;border-radius:6px;white-space:pre-wrap;' +
    'word-break:break-all;pointer-events:none;';
  box.textContent = [
    `isDecentAppWebView(): ${isDecentAppWebView()}`,
    `  via __REA_HOST__: ${detectDecentAppWebView(reaHost, false, null)}`,
    `  via bridge:       ${detectDecentAppWebView(undefined, hasBridge, null)}`,
    `  via UA token:     ${detectDecentAppWebView(undefined, false, ua)}`,
    `__REA_HOST__: ${reaHost == null ? 'absent' : JSON.stringify(reaHost)}`,
    `flutter_inappwebview: ${hasBridge ? 'present' : 'absent'}`,
    `userAgent: ${ua}`
  ].join('\n');
  document.body.appendChild(box);

  // Toggle on 10 taps of the topbar Status value. Delegated so it survives
  // re-renders; the counter resets if taps are more than 2s apart.
  let taps = 0;
  let lastTap = 0;
  document.addEventListener('click', (event) => {
    const target = event.target as Element | null;
    const stat = target?.closest?.('.top-stat');
    if (!stat || !stat.querySelector('#stat-machine')) return;
    const now = event.timeStamp;
    taps = now - lastTap > 2000 ? 1 : taps + 1;
    lastTap = now;
    if (taps >= 10) {
      taps = 0;
      box.style.display = box.style.display === 'none' ? 'block' : 'none';
    }
  });
}

const root = document.getElementById('app');

if (!root) {
  throw new Error('Beanie root element was not found');
}

window.__beanieApp?.dispose();

const app = new BeanieApp(root);
window.__beanieApp = app;
app.start();

showWebViewDetectionDebug(); // TEMP DEBUG: remove before release.

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    app.dispose();
    if (window.__beanieApp === app) delete window.__beanieApp;
  });
}
