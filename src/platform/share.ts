// Platform adapter: share text or a link. Web Share opens the native sheet from an installed
// PWA; without it the text is copied to the clipboard. Under Capacitor: the Share plugin.

export type ShareOutcome = 'shared' | 'copied' | 'failed';

export async function shareText(title: string, text: string, url?: string): Promise<ShareOutcome> {
  const data: ShareData = url ? { title, text, url } : { title, text };
  if (navigator.share) {
    try {
      await navigator.share(data);
      return 'shared';
    } catch (err) {
      if ((err as Error).name === 'AbortError') return 'shared';
    }
  }
  try {
    await navigator.clipboard.writeText(url ? `${text}\n${url}` : text);
    return 'copied';
  } catch {
    return 'failed';
  }
}
