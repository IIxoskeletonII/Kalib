// SPEC §10.2 — barcode from a still photo, decoded on the client. No live camera stream: iOS
// does not persist camera permission for installed web apps, and Safari has no BarcodeDetector.
// ZXing is loaded on first use so it never weighs on cold start.

/** Downscale to ~1024 px on the long edge: faster decode, far less memory on the phone. */
export async function downscale(file: File, maxEdge = 1024): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
}

/** EAN/UPC digits from a photo, or null when nothing readable is in it. */
export async function decodeBarcode(file: File): Promise<string | null> {
  const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
    import('@zxing/browser'),
    import('@zxing/library'),
  ]);
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E,
  ]);
  hints.set(DecodeHintType.TRY_HARDER, true);
  const reader = new BrowserMultiFormatReader(hints);
  const canvas = await downscale(file);
  // Try the photo as taken, then rotated: labels are often photographed sideways.
  for (const angle of [0, 90]) {
    const source = angle === 0 ? canvas : rotate(canvas, angle);
    try {
      const result = reader.decodeFromCanvas(source);
      const text = result.getText().trim();
      if (/^\d{8,14}$/.test(text)) return text;
    } catch {
      /* not found at this angle */
    }
  }
  return null;
}

function rotate(src: HTMLCanvasElement, degrees: number): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = src.height;
  out.height = src.width;
  const ctx = out.getContext('2d')!;
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate((degrees * Math.PI) / 180);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return out;
}
