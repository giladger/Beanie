import qrcode from 'qrcode-generator';

/**
 * Render `text` as a scannable QR code: a self-contained, scalable SVG string
 * (white background, black modules) that can be embedded directly in markup and
 * sized with CSS. Error-correction level M with an auto-sized matrix.
 */
export function renderQrSvg(text: string): string {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}
