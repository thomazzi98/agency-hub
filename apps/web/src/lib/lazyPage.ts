import { lazy, type ComponentType } from 'react';

const RELOADED_FLAG = 'agency-hub:reloaded-for-new-release';

function readFlag(): boolean {
  try {
    return sessionStorage.getItem(RELOADED_FLAG) === '1';
  } catch {
    return false;
  }
}

function writeFlag(value: boolean): void {
  try {
    if (value) sessionStorage.setItem(RELOADED_FLAG, '1');
    else sessionStorage.removeItem(RELOADED_FLAG);
  } catch {
    // Storage can be unavailable (private mode, blocked site data); the only cost is
    // that a second failure is not told apart from the first.
  }
}

/**
 * A screen whose code is fetched the first time it is visited, so the first load - the
 * sign-in screen, on a phone - does not download every screen and the upload library
 * behind two of them.
 *
 * Each deploy replaces the hashed chunks. A tab left open across one can ask for a
 * chunk that no longer exists; that is answered by loading the page again, once, which
 * picks up the new release. A second failure in a row is a real one (offline, say) and
 * is left to the error boundary rather than reloading in a loop.
 */
export function lazyPage<T extends ComponentType>(load: () => Promise<{ default: T }>) {
  return lazy(async () => {
    try {
      const module = await load();
      writeFlag(false);
      return module;
    } catch (error) {
      if (!readFlag()) {
        writeFlag(true);
        window.location.reload();
        // Keeps the fallback on screen until the reload replaces the page.
        return new Promise<{ default: T }>(() => undefined);
      }
      throw error;
    }
  });
}
