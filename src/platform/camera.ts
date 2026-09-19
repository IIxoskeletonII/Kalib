// Platform adapter for still-image capture (SPEC §10.2): the native file/camera picker only —
// never a live getUserMedia stream, whose permission is not persisted for iOS PWAs. Used by
// barcode scanning (v1) and photo estimation (v3). Under Capacitor: swap for the Camera plugin.

export function captureImage(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.setAttribute('capture', 'environment');
    input.style.display = 'none';
    input.onchange = () => {
      resolve(input.files?.[0] ?? null);
      input.remove();
    };
    input.oncancel = () => {
      resolve(null);
      input.remove();
    };
    document.body.appendChild(input);
    input.click();
  });
}
