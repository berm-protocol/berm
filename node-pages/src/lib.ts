/**
 * Everything build.mjs needs, in one bundle.
 *
 * WHY BUNDLE AT ALL. A fork-and-go template must run on a stock Node with no
 * flags. Importing `.ts` directly needs `--experimental-strip-types`, and a
 * template that requires an experimental flag is a template that breaks for the
 * person trying it — which is exactly the audience this exists for.
 *
 * Re-exports rather than reimplements: the renderer and slug rules are the ones
 * the rest of the project uses and tests, not a second copy that drifts.
 */
export { collect, merge, shouldPublish, fetchFrom } from './collect.js';
export { renderLanding } from '../../landing/src/render.js';
export { slugOrDigest, pageUrl, normaliseHandle } from '../../landing/src/slug.js';
