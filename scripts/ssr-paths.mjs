import { pathToFileURL } from 'node:url';

/**
 * A filesystem path embedded as a JavaScript module specifier.
 *
 * JSON owns the escaping. Hand-written quotes turn a Windows path such as
 * `C:\dev\www` into JavaScript escapes, and the generated entry then asks esbuild
 * for `C:devwww`.
 */
export function jsPath(path) {
  return JSON.stringify(path);
}

/** A dynamic-import URL for a local file, on Windows and POSIX alike. */
export function importUrl(path) {
  return pathToFileURL(path).href;
}

/** Vite manifest keys are web-style paths even when Node runs on Windows. */
export function viteKey(path) {
  return path.replaceAll('\\', '/');
}
