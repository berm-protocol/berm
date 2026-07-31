/**
 * A suite must never test against a server it did not start.
 *
 *   import { claimPort } from '../scripts/ports.mjs';
 *   const http = claimPort(createServer(handler), 8100, 'editor page');
 *
 * WHY. `createServer(h).listen(8100)` reports a busy port through an async
 * 'error' event. With no handler attached, the script sails on and the browser
 * loads whatever else is on 8100 — a leftover server from an earlier run,
 * serving a different checkout.
 *
 * That actually happened here: a stale `serve.mjs` held the port and three
 * consecutive runs of the SDK example suite failed with a misleading message
 * about the dev-signer warning, while the code under test was fine. Red for the
 * wrong reason is the mild version. The severe version is the same stale server
 * happening to serve a *passing* page, and a suite going green having tested
 * nothing it built — which is the exact failure this repo exists to not have.
 *
 * So: bind or die, loudly, naming the port and what wanted it.
 */

import { createServer } from 'node:net';

/**
 * Attach a fatal error handler to a server that is being told to listen.
 *
 * Returns the server so it can be used inline. `listen` may already have been
 * called — Node queues the 'error' event, so attaching immediately afterwards
 * still catches EADDRINUSE.
 */
export function claimPort(server, port, what = 'this suite') {
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.error(
        `\n  port ${port} is already in use, so ${what} cannot start its own server.\n` +
        `  Refusing to continue: whatever is on ${port} is not what this run built,\n` +
        `  and testing against it would prove nothing.\n\n` +
        `  Find it with:  ss -ltnp | grep ${port}\n`,
      );
    } else {
      console.error(`\n  ${what} could not listen on ${port}: ${e.message}\n`);
    }
    process.exit(1);
  });
  return server;
}

/**
 * Check a port before spawning a *separate* process to serve on it.
 *
 * A child spawned with stdio 'ignore' takes its bind failure to the grave, so
 * the parent has to ask first. Racy in principle — something could take the port
 * between the check and the bind — but the case this defends against is a stale
 * server that has been sitting there for minutes, not a photo finish.
 */
export function assertPortFree(port, what = 'this suite') {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', (e) => {
      console.error(
        `\n  port ${port} is already in use, so ${what} cannot start its own server.\n` +
        `  Refusing to continue: whatever is on ${port} is not what this run built.\n` +
        `  (${e.code})\n\n  Find it with:  ss -ltnp | grep ${port}\n`,
      );
      process.exit(1);
    });
    probe.once('listening', () => probe.close(() => resolve()));
    probe.listen(port, '127.0.0.1');
  });
}
