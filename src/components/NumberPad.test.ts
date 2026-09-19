import { describe, expect, it } from 'vitest';
import { appendDigit } from './NumberPad';

describe('appendDigit', () => {
  it('appends digits and caps length', () => {
    expect(appendDigit('', '5', false, 4)).toBe('5');
    expect(appendDigit('123', '4', false, 4)).toBe('1234');
    expect(appendDigit('1234', '5', false, 4)).toBe('1234');
  });

  it('prevents leading zeros', () => {
    expect(appendDigit('0', '7', false, 4)).toBe('7');
    expect(appendDigit('0', '0', false, 4)).toBe('0');
  });

  it('handles a single decimal separator', () => {
    expect(appendDigit('', '.', true, 4)).toBe('0.');
    expect(appendDigit('10', '.', true, 4)).toBe('10.');
    expect(appendDigit('10.', '.', true, 4)).toBe('10.');
    expect(appendDigit('10', '.', false, 4)).toBe('10');
    expect(appendDigit('10.5', '5', true, 3)).toBe('10.5');
  });

  it('backspaces', () => {
    expect(appendDigit('10.5', 'backspace', true, 4)).toBe('10.');
    expect(appendDigit('', 'backspace', true, 4)).toBe('');
  });
});
