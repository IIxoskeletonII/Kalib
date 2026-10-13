// Platform adapter for still images (SPEC §10.2): the native file picker only — never a live
// getUserMedia stream, whose permission is not persisted for iOS PWAs. Under Capacitor: swap for
// the Camera plugin.
//
// Two entry points, because the right source depends on the job. A barcode has to be in front of
// you, so `captureImage` asks for the camera directly. A meal, a menu or a packet label may well
// have been photographed an hour ago, so `pickImage` leaves the source to the OS, which then
// offers the library *and* the camera in its own sheet — fewer taps than a chooser of our own,
// and the one iOS users already know.

function openPicker(capture: boolean): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (capture) input.setAttribute('capture', 'environment');
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

/** Straight to the rear camera: for things that must be in front of the lens, like a barcode. */
export function captureImage(): Promise<File | null> {
  return openPicker(true);
}

/** Camera or photo library, the OS asks which: for a meal, a menu or a nutrition label. */
export function pickImage(): Promise<File | null> {
  return openPicker(false);
}
