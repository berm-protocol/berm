/**
 * Bundle entry point. Nothing but the call — everything testable lives in
 * modules that a unit test can import without a browser.
 */
import { bootstrap } from './hydrate.js';
bootstrap();
