// The share adapter's three outcomes, against stand-ins for the two browser APIs it uses. Every
// path matters to the person holding the phone: "shared" closes quietly, "copied" needs a toast
// saying so, and "failed" needs one saying it did not work.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { shareText } from './share';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubNavigator(n: { share?: unknown; clipboard?: unknown }) {
  vi.stubGlobal('navigator', n);
}

describe('shareText', () => {
  it('opens the share sheet where there is one', async () => {
    const share = vi.fn(async () => {});
    const writeText = vi.fn(async () => {});
    stubNavigator({ share, clipboard: { writeText } });
    expect(await shareText('Push A', 'Push A — Tue')).toBe('shared');
    expect(share).toHaveBeenCalledWith({ title: 'Push A', text: 'Push A — Tue' });
    expect(writeText).not.toHaveBeenCalled();
  });

  it('passes a link through when given one', async () => {
    const share = vi.fn(async () => {});
    stubNavigator({ share });
    await shareText('Recipe', 'Soup', 'https://example.test/r');
    expect(share).toHaveBeenCalledWith({
      title: 'Recipe',
      text: 'Soup',
      url: 'https://example.test/r',
    });
  });

  it('treats closing the sheet as done, not as a failure to copy instead', async () => {
    const share = vi.fn(async () => {
      throw new DOMException('Share canceled', 'AbortError');
    });
    const writeText = vi.fn(async () => {});
    stubNavigator({ share, clipboard: { writeText } });
    expect(await shareText('Push A', 'text')).toBe('shared');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('copies instead when the sheet is refused', async () => {
    // NotAllowedError: Safari without a fresh gesture, or a policy that blocks sharing.
    const share = vi.fn(async () => {
      throw new DOMException('Not allowed', 'NotAllowedError');
    });
    const writeText = vi.fn(async () => {});
    stubNavigator({ share, clipboard: { writeText } });
    expect(await shareText('Push A', 'the text')).toBe('copied');
    expect(writeText).toHaveBeenCalledWith('the text');
  });

  it('copies where there is no share sheet (most desktops)', async () => {
    const writeText = vi.fn(async () => {});
    stubNavigator({ clipboard: { writeText } });
    expect(await shareText('Push A', 'the text')).toBe('copied');
    expect(writeText).toHaveBeenCalledWith('the text');
  });

  it('copies the link after the text when it has to copy', async () => {
    const writeText = vi.fn(async () => {});
    stubNavigator({ clipboard: { writeText } });
    await shareText('Recipe', 'Soup', 'https://example.test/r');
    expect(writeText).toHaveBeenCalledWith('Soup\nhttps://example.test/r');
  });

  it('says it failed when neither works', async () => {
    const writeText = vi.fn(async () => {
      throw new DOMException('Denied', 'NotAllowedError');
    });
    stubNavigator({ clipboard: { writeText } });
    expect(await shareText('Push A', 'text')).toBe('failed');
  });

  it('says it failed where there is no clipboard either', async () => {
    stubNavigator({});
    expect(await shareText('Push A', 'text')).toBe('failed');
  });
});
