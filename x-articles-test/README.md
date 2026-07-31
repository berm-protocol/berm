# X Articles API — draft harness

Zero dependencies. Node 18+ (uses built-in `fetch` and `crypto`).

## Before the first run

Add this exact callback URL to your app in the X developer portal:

```
http://127.0.0.1:8765/callback
```

It must match character for character, including the port.

Also confirm the app requests these scopes: `tweet.read`, `tweet.write`,
`users.read`, `offline.access`.

## Run

```bash
node x-articles-test.mjs --client-id=YOUR_CLIENT_ID
```

Add `--client-secret=...` **only** if your app is a Confidential client.
Public / Native clients use PKCE alone and need no secret — try without first.

It prints an authorisation URL. Open it, approve, and the tool catches the
callback, exchanges the code, and runs the sequence. The token is cached in
`.x-token.json`, so later runs skip the browser step (`--reauth` forces a fresh
login).

## What it runs, and why in this order

If you fire a rich payload at an untested endpoint and get a 400, you cannot
tell whether the token is wrong, the scope is missing, or the JSON shape is
wrong. So it escalates and stops at the first failure with the full response.

| | Test | Answers |
|---|---|---|
| T1 | `GET /2/users/me` | is the token real, and who is it |
| T2 | minimal draft, verbatim from X's docs | does this account have Articles access at all |
| T3 | `entities: []` | X's documented entity shape |
| T4 | `entityMap: {}` | standard DraftJS entity shape |
| T5 | rich payload | which block types X actually accepts |
| T6 | publish | only with `--publish` |

**T3 vs T4 is the point of the exercise.** X's docs show `entities` as an
array; standard DraftJS ContentState uses `entityMap` as an object keyed by
string. Our serializer currently emits `entityMap`. One of them is right, and
the harness tells you which — after which the serializer gets a one-line fix or
none at all.

## Flags

| Flag | Effect |
|---|---|
| `--client-secret=…` | Confidential clients only |
| `--publish` | actually publishes T2's draft — **posts publicly** |
| `--payload=file.json` | also POSTs your own payload (paste it from the editor's Output tab) |
| `--reauth` | ignore the cached token |
| `--verbose` | print successful responses too |
| `--port=8765` | change the callback port (re-register the URL if you do) |

## After it runs

Drafts are **not public**. Open `x.com/compose/articles` and look at what
actually rendered — that's the real result. The HTTP status only tells you the
request was accepted, not that headings became headings.

Two things worth noting while you're in there:

- which of `header-one` / `header-two` / `header-three` survive (paste testing
  suggested only two heading levels exist)
- whether the title field is populated from `title`, or still needs typing

Everything is logged to `x-articles-result.json`.

## If T2 fails

That's an access problem, not a payload problem. In order of likelihood:

1. The authorising account doesn't have X Premium — Articles are Premium-only
2. `tweet.write` wasn't granted (the tool prints the granted scopes after login)
3. Your access tier doesn't include the Articles endpoints
4. The callback URL doesn't match what's registered

## If the token exchange fails

The error text usually names the cause. Two common ones:

- mentions `redirect_uri` → the registered callback doesn't match exactly
- mentions `client` and you passed no secret → your app is Confidential, add
  `--client-secret=…`
