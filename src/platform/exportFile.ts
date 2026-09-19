// Platform adapter: hand a generated file to the user. Web Share with files (iOS 15+) opens
// the share sheet from an installed PWA; otherwise fall back to a download link. Under
// Capacitor this becomes the native share plugin — nothing else in the app changes.

export interface ExportFile {
  name: string;
  mime: string;
  content: string;
}

export async function exportFiles(files: ExportFile[]): Promise<'shared' | 'downloaded'> {
  const blobs = files.map((f) => new File([f.content], f.name, { type: f.mime }));
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: blobs })) {
    try {
      await nav.share({ files: blobs, title: 'Kalib export' });
      return 'shared';
    } catch (err) {
      if ((err as Error).name === 'AbortError') return 'shared';
      // fall through to download
    }
  }
  for (const b of blobs) {
    const url = URL.createObjectURL(b);
    const a = document.createElement('a');
    a.href = url;
    a.download = b.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  return 'downloaded';
}
