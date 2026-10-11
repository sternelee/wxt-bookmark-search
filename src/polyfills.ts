/**
 * Runtime polyfills for cross-browser compatibility.
 * Import once at the top-level entry point (e.g. background.ts).
 */

/** Polyfill AbortSignal.timeout for Firefox <124 and older browsers. */
function polyfillAbortSignalTimeout(): void {
  if (
    typeof AbortSignal !== "undefined" &&
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    !AbortSignal.timeout
  ) {
    (AbortSignal as any).timeout = function (ms: number): AbortSignal {
      const controller = new AbortController();
      setTimeout(() => {
        controller.abort(
          new DOMException("The operation timed out.", "TimeoutError"),
        );
      }, ms);
      return controller.signal;
    };
  }
}

/** Polyfill AbortSignal.any for older browsers (e.g. Firefox <124). */
function polyfillAbortSignalAny(): void {
  if (
    typeof AbortSignal !== "undefined" &&
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    !AbortSignal.any
  ) {
    (AbortSignal as any).any = function (signals: AbortSignal[]): AbortSignal {
      const controller = new AbortController();
      for (const signal of signals) {
        if (signal.aborted) {
          controller.abort(signal.reason);
          return controller.signal;
        }
        signal.addEventListener(
          "abort",
          () => controller.abort(signal.reason),
          { once: true },
        );
      }
      return controller.signal;
    };
  }
}

export function installPolyfills(): void {
  polyfillAbortSignalTimeout();
  polyfillAbortSignalAny();
}
