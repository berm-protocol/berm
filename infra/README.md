# Infrastructure — runbook

Two boxes. Neither shares a credential with the other, or with anything else.

| Host | Serves | Why it is its own machine |
|---|---|---|
| **bermlaunch.com** | the launch composer and enrollment | Public, money-adjacent, and probed on purpose. Also the thing GitHub Pages policy makes risky to host there |
| **xonly.ai** | apex, `signer.xonly.ai`, `editor.xonly.ai` | Tier-1 custody. Compromise here reaches users' **keys**, so it must not share an OS with the launchpad |

```
bermlaunch.com  ──── signature requests ────▶  signer.xonly.ai
   (client)                                       (broker)
       ◀────────── signed events ──────────────
                   never a key
```

That is the interconnection, and it is the point: two independent hosts, one
identity, and a client that can obtain signatures without ever being able to
obtain the key. See [`spec/signer-broker.md`](../spec/signer-broker.md).

## Provisioning

`cloud-init.bermlaunch.yaml` and `cloud-init.xonly.yaml` are pasted into
Hetzner's **Cloud config** box at server creation, or sent as `user_data` via the
API. CX23, Ubuntu 24.04, Falkenstein, IPv4 + IPv6.

Each box gets its **own** SSH key — `id_bermlaunch`, `id_xonly`. Not the DIP
key, not each other's. One box, one credential, so a compromise reaches one box.

Pin the primary IPs (`auto_delete: false`) immediately after creation. A rebuild
otherwise hands you a new address and DNS has to be redone.

## Four mistakes, all paid for

Every one of these presented as *"the server accepts TCP on :80 and serves
nothing"*, which points nowhere near the cause. They are listed because the
symptom is identical and the causes are not.

**1. Writing `/etc/caddy/Caddyfile` before installing caddy.** dpkg finds a
config file it did not ship, stops at a conffile prompt with no stdin, and the
package stays *unconfigured* — installed, never started.

```
Configuration file '/etc/caddy/Caddyfile'
*** Caddyfile (Y/I/N/O/D/Z) [default=N] ?
dpkg: error processing package caddy: end of file on stdin at conffile prompt
```

Install first, write config after. `--force-confold` as well, not instead.

**2. `gpg --dearmor` with no `--batch --yes`.** On a re-run the keyring already
exists, gpg tries to ask about overwriting, finds no tty, and dies.

**3. `sudo -u berm`.** That *authenticates* as berm, and a cloud-init user has no
password, so sudo demands one and fails with *"Account or password is expired"*.
Use `runuser -u berm --`, which only drops privileges.

**4. `package_upgrade: true`.** It races unattended-upgrades for the dpkg lock at
first boot and whichever loses fails silently. Leave it off; unattended-upgrades
runs afterwards when nothing is competing.

And a fifth that is not cloud-init's fault: **Caddy rejects `{ … }` on one
line.**

```
handle /health { respond "ok" 200 }     # rejected
```

`caddy validate` catches it — on a machine with caddy installed, which is the
machine you are trying to provision. `scripts/check-caddyfile.mjs` catches it
here instead. Run it before any Caddyfile ships:

```
node scripts/check-caddyfile.mjs infra/Caddyfile.xonly
```

## Verify without logging in

Every box serves `/health` over **plain HTTP**, before any certificate exists.
This is deliberate: the first failure was a refused connection, and a refused
connection tells you nothing about why.

```
curl http://<ip>/health        →  xonly-ok  |  berm-ok
```

If that does not answer, read `/var/log/<host>-provision.log`. It records every
step and which one failed. `/var/lib/<host>-provisioned` exists only if the whole
run succeeded — its absence is the fastest signal available.

## DNS

Apex records must be `A`/`AAAA`. **A CNAME on the apex is not valid DNS**, and
Namecheap will either reject it or do something surprising. Only subdomains take
CNAMEs.

Point DNS **before** first load. Caddy requests its certificate on first request
for a hostname; if DNS is not resolving yet, that attempt fails and retries on a
growing backoff. Nothing is broken, it is just slower than you want, and a
`systemctl restart caddy` resets the backoff once DNS is right.

## The ROR file is a trust boundary

`https://xonly.ai/.well-known/webauthn` lists origins allowed to use RP ID
`xonly.ai`. **Every entry is a full grant of identity power** — an origin in that
list can request `prf_out` and derive users' keys.

It ships **empty**. `bermlaunch.com` goes in only after the signer is deployed
and its attestation verifies, and it is not needed at all if bermlaunch uses the
broker (which it should — see the spec). Treat this one line of JSON as more
sensitive than the signer's source.

Clients are capped at ~5 labels by the specification. Spend them on domains you
own.

## What does not belong on these boxes

GitHub Pages keeps the docs and the spec site — anything that **never signs**.

The editor is served from `editor.xonly.ai` rather than GitHub Pages, and the
reason is not preference: the editor signs, so it would need to be in the ROR
list, which would hand GitHub the ability to serve JavaScript that reads
`prf_out`. Source on GitHub, running code on a domain you control.
