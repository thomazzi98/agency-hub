/** Mirrors apps/api/src/modules/branding/contrast.ts so the UI can warn before saving. */

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function isHexColor(value: string): boolean {
  return HEX_COLOR.test(value);
}

function channels(hexColor: string): [number, number, number] {
  return [
    Number.parseInt(hexColor.slice(1, 3), 16),
    Number.parseInt(hexColor.slice(3, 5), 16),
    Number.parseInt(hexColor.slice(5, 7), 16),
  ];
}

function toHex(value: number): string {
  return Math.round(Math.min(255, Math.max(0, value)))
    .toString(16)
    .padStart(2, '0');
}

/** `amount` of 0 keeps the colour, 1 becomes the target. */
export function mix(hexColor: string, target: string, amount: number): string {
  if (!isHexColor(hexColor) || !isHexColor(target)) return hexColor;

  const [red, green, blue] = channels(hexColor);
  const [targetRed, targetGreen, targetBlue] = channels(target);

  return `#${toHex(red + (targetRed - red) * amount)}${toHex(
    green + (targetGreen - green) * amount,
  )}${toHex(blue + (targetBlue - blue) * amount)}`;
}

function channelLuminance(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hexColor: string): number {
  const [red, green, blue] = channels(hexColor);
  return (
    0.2126 * channelLuminance(red) +
    0.7152 * channelLuminance(green) +
    0.0722 * channelLuminance(blue)
  );
}

export function contrastRatio(foreground: string, background: string): number {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

export const MINIMUM_CONTRAST_RATIO = 4.5;

export function meetsMinimumContrast(color: string): boolean {
  return isHexColor(color) && contrastRatio(color, '#ffffff') >= MINIMUM_CONTRAST_RATIO;
}
