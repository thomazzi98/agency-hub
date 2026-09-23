import { Component, type ErrorInfo, type ReactNode } from 'react';
import { strings } from '../lib/strings';

interface Props {
  children: ReactNode;
  /**
   * When this changes after a failure, the boundary tries its children again - so
   * leaving a screen that failed clears the failure. It deliberately does not remount
   * anything that is working: a screen can navigate to its own next address and keep
   * its state (a new user's one-time password survives `/usuarios/novo` becoming
   * `/usuarios/:id`), which keying the boundary by the path would destroy.
   */
  resetKey?: string;
}

/**
 * What a screen shows when rendering it throws - a bug, or a route's code that could
 * not be fetched. Without a boundary React unmounts the whole tree and the person is
 * left looking at a blank page with no way forward but to guess that a reload helps.
 *
 * Placed inside the shell as well as around the app: a failing screen then keeps the
 * header, so every other section is still one tap away.
 */
export class ErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // The console is the only place this can go from a browser; there is no client
    // error reporting service in Phase 1.
    console.error('[ui] a screen failed to render', error, info.componentStack);
  }

  componentDidUpdate(previous: Props): void {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <div
        role="alert"
        className="mx-auto flex max-w-sm flex-col items-center gap-3 py-16 text-center"
      >
        <p className="text-base font-semibold text-slate-900">{strings.app.crashTitle}</p>
        <p className="text-sm text-slate-600">{strings.app.crashHint}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700"
        >
          {strings.app.reload}
        </button>
      </div>
    );
  }
}
