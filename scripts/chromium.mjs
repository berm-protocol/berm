/**
 * How every browser suite in this repo launches Chromium.
 *
 *   import { launch } from '../scripts/chromium.mjs';
 *   const browser = await launch(chromium);
 *
 * WHY THIS EXISTS. Ten verify scripts had `executablePath: '/opt/pw-browsers/chromium'`
 * hardcoded — an absolute path that exists in one particular sandbox and nowhere
 * else. Every browser suite passed there and every one of them failed on the
 * first CI run with `executable doesn't exist`. A forker would have hit the same
 * thing, with no way to guess where the path came from.
 *
 * Resolution order, most explicit first:
 *
 *   1. CHROMIUM_PATH          an operator saying exactly which binary to use
 *   2. PLAYWRIGHT_BROWSERS_PATH/chromium   a preinstalled browser pool, if real
 *   3. /opt/pw-browsers/chromium           the sandbox default, IF IT EXISTS
 *   4. nothing                Playwright's own managed download — the normal case
 *
 * Every branch above 4 is conditional on the file actually being there. A
 * configured path that does not exist must fall through rather than be passed to
 * Playwright, because the resulting error names a path the reader has never seen
 * and sends them looking in the wrong place entirely.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** The candidate list, in order. Exported so a check can assert it is used. */
export function chromiumPath() {
  const candidates = [
    process.env.CHROMIUM_PATH,
    process.env.PLAYWRIGHT_BROWSERS_PATH
      ? join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium')
      : null,
    '/opt/pw-browsers/chromium',
  ].filter(Boolean);

  return candidates.find((p) => existsSync(p)) ?? null;
}

/** Launch options only — for callers that need to add their own. */
export function launchOptions(extra = {}) {
  const path = chromiumPath();
  return path ? { executablePath: path, ...extra } : { ...extra };
}

/**
 * `launch(chromium)` rather than importing playwright here: each package has its
 * own install, and this file must stay dependency-free so it can be imported
 * from any of them without being part of any of them.
 */
export function launch(browserType, extra = {}) {
  return browserType.launch(launchOptions(extra));
}
