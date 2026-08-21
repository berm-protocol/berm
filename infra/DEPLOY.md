# Deploying xonly.ai

**Pull, never push.** The server holds its own deploy key and fetches from
GitHub. No long-lived credential leaves the box, and nothing on a laptop or in a
sandbox can publish to production.

## Once, to wire it up

```bash
ssh root@167.233.229.170
cat /home/berm/DEPLOY_KEY.pub          # created at provision time
```

Add that as a **read-only deploy key** on the repository, then:

```bash
cat >/etc/xonly.env <<'ENV'
GIT_REMOTE=git@github.com:<owner>/<repo>.git
GIT_BRANCH=main
PUBLISH_DIR=public
ENV

install -m 0755 /srv/xonly/src/infra/xonly-deploy /usr/local/bin/xonly-deploy
```

## Every deploy

```bash
sudo xonly-deploy
```

It clones or fast-forwards, checks each bundle against the served CSP, swaps by
rename so no visitor sees a half-copied tree, validates the Caddyfile, reloads
Caddy, and prints the status of all three hosts.

## The bundles are tracked in git, on purpose

`dist/` is normally ignored. `signer/dist/xonly-signer.html`,
`editor/dist/xonly-editor.html` and both `csp.txt` files are **exceptions** and
must stay committed — `xonly-deploy` publishes what git contains.

Three things then commit to the same bytes and can be checked against each
other by anyone: the **git blob**, the **served CSP hash**, and the
**signer-log attestation**. Building on the server instead would put node, npm
and a dependency tree on the machine that holds keys, and leave the served bytes
reproducible from nowhere.

If a bundle is missing, the deploy **fails with a non-zero exit** rather than
skipping the host. An earlier version skipped and exited 0, which meant a deploy
that published nothing looked exactly like a deploy that worked.

## The one thing that will bite you

Both apps ship as **one self-contained file** served under
`script-src 'self' 'sha256-…'`. **If the Caddyfile's hash and the bundle
disagree, the browser refuses the script and the page is blank** — no error, no
log line, just an empty page that looks like a CSS problem.

So the order is always:

1. `npm run build` in `signer/` and `editor/` — each writes `dist/csp.txt`
2. copy those policies into `infra/Caddyfile.xonly`
3. commit **bundle and Caddyfile together**
4. `sudo xonly-deploy`

`xonly-deploy` recomputes the hash from the bytes it is about to publish and
**refuses to swap** if the served policy does not contain it. Dry-run, three
cases:

```
agreement        : publish
script changed   : new hash differs -> REFUSE, Caddyfile lacks it
bundle absent    : skip that host, current site untouched
```

A refusal is the intended outcome, not a bug to work around. Update the
Caddyfile and rerun.

## What is and is not ready

| Host | Serves | State |
|---|---|---|
| `signer.xonly.ai` | `signer/dist/xonly-signer.html` | **ready** |
| `editor.xonly.ai` | `editor/dist/xonly-editor.html` | **ready** |
| `xonly.ai` | `public/` tree | **does not exist yet** — the deploy skips it and leaves the placeholder |

## Rotate first

`CANARY-READINESS.md` §5a lists the Hetzner token and Bags API key as owed
rotations. Anything issued during provisioning has been sitting in chat
transcripts and sandbox filesystems since. Rotate before this box starts serving
something people rely on, not after.
