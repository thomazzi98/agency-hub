/**
 * WCAG 2.1 relative luminance and contrast ratio.
 *
 * Custom brand colours are checked against this before they can be saved, because a
 * brand colour is not only decoration here: it becomes the background of primary
 * buttons and of dark surfaces, both of which carry white text. An admin picking a
 * pale yellow would otherwise ship unreadable controls to every user
 * (12-ui-ux-guidelines.md#accessibility).
 */

/** WCAG AA for normal-size text. */
export const MINIMUM_CONTRAST_RATIO = 4.5;

export const WHITE = '#ffffff';

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function isHexColor(value: string): boolean {
  return HEX_COLOR.test(value);
}

function channelLuminance(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hexColor: string): number {
  if (!isHexColor(hexColor)) {
    throw new Error(`Not a six-digit hex colour: ${hexColor}`);
  }

  const red = Number.parseInt(hexColor.slice(1, 3), 16);
  const green = Number.parseInt(hexColor.slice(3, 5), 16);
  const blue = Number.parseInt(hexColor.slice(5, 7), 16);

  return (
    0.2126 * channelLuminance(red) +
    0.7152 * channelLuminance(green) +
    0.0722 * channelLuminance(blue)
  );
}

export function contrastRatio(foreground: string, background: string): number {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);

  return (lighter + 0.05) / (darker + 0.05);
}

export function meetsMinimumContrast(color: string, against: string = WHITE): boolean {
  return contrastRatio(color, against) >= MINIMUM_CONTRAST_RATIO;
}
