import { buildHandoffUrl, isHandoffArrival } from '../domain/labelScanHandoff';
import { renderQrSvg } from '../components/qr';

run('builds a hand-off URL from a LAN page, marking it for the phone', () => {
  equal(buildHandoffUrl('http://192.168.1.42:3000/'), 'http://192.168.1.42:3000/?beanieScan=1');
});

run('strips existing query and hash from the hand-off URL', () => {
  equal(buildHandoffUrl('http://192.168.1.42:3000/app?x=1#y'), 'http://192.168.1.42:3000/app?beanieScan=1');
});

run('returns null for loopback hosts the phone cannot reach', () => {
  equal(buildHandoffUrl('http://localhost:3000/'), null);
  equal(buildHandoffUrl('http://127.0.0.1:5173/'), null);
  equal(buildHandoffUrl('not a url'), null);
});

run('prefers the gateway LAN host over a loopback page origin', () => {
  equal(buildHandoffUrl('http://localhost:3000/', '192.168.1.42'), 'http://192.168.1.42:3000/?beanieScan=1');
  // A blank LAN host falls back to the page host (still loopback -> null).
  equal(buildHandoffUrl('http://localhost:3000/', '  '), null);
});

run('detects arrival from a hand-off QR', () => {
  equal(isHandoffArrival('?beanieScan=1'), true);
  equal(isHandoffArrival('?other=1'), false);
  equal(isHandoffArrival(''), false);
});

run('renders a scannable QR as a scalable SVG', () => {
  const svg = renderQrSvg('http://192.168.1.42:3000/?beanieScan=1');
  equal(svg.startsWith('<svg'), true);
  equal(svg.includes('viewBox'), true);
});

function run(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

function equal<T>(actual: T, expected: T): void {
  if (actual !== expected) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}
