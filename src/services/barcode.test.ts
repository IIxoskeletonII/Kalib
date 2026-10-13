// Picking from the photo library, unlike the camera, can hand over whatever the gallery holds.
// An iPhone HEIC is the common case and no browser engine here decodes it, so the message the
// user gets matters: the raw DOMException says "The source image could not be decoded", which
// names no cause and suggests no way out.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { downscale } from './barcode';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('downscale', () => {
  it('explains an undecodable image rather than leaking the DOM error', async () => {
    vi.stubGlobal('createImageBitmap', () =>
      Promise.reject(new DOMException('The source image could not be decoded')),
    );
    const heic = { type: 'image/heic' } as File;
    await expect(downscale(heic)).rejects.toThrow(/could not be read \(image\/heic\)/);
    // And says what to do about it.
    await expect(downscale(heic)).rejects.toThrow(/screenshot/);
  });

  it('leaves the type out when the file does not report one', async () => {
    vi.stubGlobal('createImageBitmap', () => Promise.reject(new Error('nope')));
    await expect(downscale({ type: '' } as File)).rejects.toThrow(
      'That image could not be read. Try a JPEG or PNG — a screenshot of the photo always works.',
    );
  });
});
