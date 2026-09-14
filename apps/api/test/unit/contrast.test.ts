import { describe, expect, it } from 'vitest';
import {
  MINIMUM_CONTRAST_RATIO,
  WHITE,
  contrastRatio,
  isHexColor,
  meetsMinimumContrast,
  relativeLuminance,
} from '../../src/modules/branding/contrast.js';

describe('hex colour validation', () => {
  it.each(['#1d4ed8', '#000000', '#FFFFFF'])('accepts %s', (value) => {
    expect(isHexColor(value)).toBe(true);
  });

  it.each(['1d4ed8', '#fff', '#1d4ed', '#1d4ed8f', 'blue', ''])('rejects %s', (value) => {
    expect(isHexColor(value)).toBe(false);
  });
});

describe('relative luminance', () => {
  it('matches the WCAG reference values at both extremes', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5);
  });

  it('throws rather than silently scoring a malformed colour', () => {
    expect(() => relativeLuminance('nope')).toThrow();
  });
});

describe('contrast ratio', () => {
  it('reports the known 21:1 maximum for black on white', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 2);
  });

  it('is symmetric', () => {
    expect(contrastRatio('#1d4ed8', WHITE)).toBeCloseTo(contrastRatio(WHITE, '#1d4ed8'), 10);
  });

  it('reports 1:1 for a colour against itself', () => {
    expect(contrastRatio('#1d4ed8', '#1d4ed8')).toBeCloseTo(1, 10);
  });
});

describe('minimum contrast against white text', () => {
  it('accepts the shipped brand colours', () => {
    expect(meetsMinimumContrast('#1d4ed8')).toBe(true);
    expect(meetsMinimumContrast('#0f172a')).toBe(true);
  });

  it('rejects colours that would make white button labels unreadable', () => {
    // Pale yellow and light grey both look fine in a colour picker and fail in use.
    expect(meetsMinimumContrast('#ffe066')).toBe(false);
    expect(meetsMinimumContrast('#cccccc')).toBe(false);
  });

  it('uses WCAG AA for normal text as the threshold', () => {
    expect(MINIMUM_CONTRAST_RATIO).toBe(4.5);
  });
});
