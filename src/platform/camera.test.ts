// The one thing worth guarding here is which picker gets `capture="environment"`. With it, iOS
// opens the camera and never shows the library; without it, the OS offers both. A barcode needs
// the camera; a meal, a menu or a nutrition label may already be in the camera roll.
//
// Tests run in Node with no DOM (vite.config.ts: environment 'node'), so the few DOM calls this
// adapter makes are stubbed rather than pulling in jsdom for one file.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureImage, pickImage } from './camera';

interface FakeInput {
  type: string;
  accept: string;
  style: { display: string };
  attrs: Record<string, string>;
  files: unknown[] | null;
  onchange: (() => void) | null;
  oncancel: (() => void) | null;
  setAttribute(k: string, v: string): void;
  remove(): void;
  click(): void;
  clicked: boolean;
  removed: boolean;
}

let created: FakeInput[] = [];
let appended: FakeInput[] = [];

function install() {
  created = [];
  appended = [];
  const el = (): FakeInput => {
    const o: FakeInput = {
      type: '',
      accept: '',
      style: { display: '' },
      attrs: {},
      files: null,
      onchange: null,
      oncancel: null,
      clicked: false,
      removed: false,
      setAttribute(k, v) {
        o.attrs[k] = v;
      },
      remove() {
        o.removed = true;
      },
      click() {
        o.clicked = true;
      },
    };
    created.push(o);
    return o;
  };
  vi.stubGlobal('document', {
    createElement: () => el(),
    body: {
      appendChild: (n: FakeInput) => {
        appended.push(n);
        return n;
      },
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('image pickers', () => {
  it('sends the barcode scanner straight to the camera', () => {
    install();
    void captureImage();
    const input = created[0]!;
    expect(input.attrs.capture).toBe('environment');
    expect(input.type).toBe('file');
    expect(input.accept).toBe('image/*');
    expect(input.clicked).toBe(true);
    expect(appended).toHaveLength(1);
  });

  it('leaves the source to the OS for a meal, a menu or a label', () => {
    install();
    void pickImage();
    // No `capture`: this is what lets iOS show "Photo Library" alongside "Take Photo".
    expect(created[0]!.attrs.capture).toBeUndefined();
    expect(created[0]!.accept).toBe('image/*');
  });

  it('resolves the chosen file and cleans the input up', async () => {
    install();
    const p = pickImage();
    const input = created[0]!;
    const file = { name: 'meal.jpg' };
    input.files = [file];
    input.onchange!();
    await expect(p).resolves.toBe(file);
    expect(input.removed).toBe(true);
  });

  it('resolves null when the picker is dismissed', async () => {
    install();
    const p = captureImage();
    const input = created[0]!;
    input.oncancel!();
    await expect(p).resolves.toBeNull();
    expect(input.removed).toBe(true);
  });

  it('resolves null when the picker returns nothing', async () => {
    install();
    const p = pickImage();
    const input = created[0]!;
    input.files = [];
    input.onchange!();
    await expect(p).resolves.toBeNull();
  });
});
