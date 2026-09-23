/**
 * "Chrome · Windows" from a user-agent string, for the sessions screen: the raw string
 * ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 …") truncated to one
 * line told nobody which of their devices a session was, which is the one thing they
 * need to know before ending it. Best effort - an unrecognised agent falls back to the
 * raw text rather than to nothing.
 */
export function describeDevice(userAgent: string | null): string | null {
  if (!userAgent) return null;

  // Order matters: Edge, Opera and Samsung Internet also claim to be Chrome, and every
  // Chromium browser also claims to be Safari.
  const browser = /Edg(e|A|iOS)?\//.test(userAgent)
    ? 'Edge'
    : /OPR\/|Opera/.test(userAgent)
      ? 'Opera'
      : /SamsungBrowser\//.test(userAgent)
        ? 'Samsung Internet'
        : /Firefox\/|FxiOS\//.test(userAgent)
          ? 'Firefox'
          : /Chrome\/|CriOS\//.test(userAgent)
            ? 'Chrome'
            : /Safari\//.test(userAgent)
              ? 'Safari'
              : null;

  const system = /iPhone|iPad|iPod/.test(userAgent)
    ? 'iOS'
    : /Android/.test(userAgent)
      ? 'Android'
      : /Windows/.test(userAgent)
        ? 'Windows'
        : /Mac OS X|Macintosh/.test(userAgent)
          ? 'macOS'
          : /CrOS/.test(userAgent)
            ? 'ChromeOS'
            : /Linux/.test(userAgent)
              ? 'Linux'
              : null;

  if (browser && system) return `${browser} · ${system}`;
  return browser ?? system ?? null;
}
