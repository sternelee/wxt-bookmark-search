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

export function installPolyfills(): void {
  polyfillAbortSignalTimeout();
}
