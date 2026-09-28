# Methods and versioning

## Identifier grammar

Every protocol identifier has the form `berm.<name>/<version>`, for example
`berm.external_account_binding.x/2`. Versions are positive integers with no
leading zero.

## Separate identities, separately hashed

| Identity | Decides |
|---|---|
| `berm.external_account_binding.x/2` (method) | the six-field derivation and the five-minute law |
| `berm.acquisition.x-direct-status/1` (acquisition) | which locator may be turned into a fetch; zero redirects |
| `berm.transport.x-syndication-via-same-origin-proxy/2` (transport) | how the public publication is acquired |
| `berm.external_account_binding/1` (generic shape) | the shape a future namespace must fit; not implemented |
| `berm.composer_producer_law/2` (producer) | how proof posts are composed |

A change to intake does not silently change the method identity; a change to a
constant that decides a binding (such as the 300000 ms bound) **does** change
`methodHash`.

## Lineage of the X method

| Identity | Standing |
|---|---|
| `berm.handle_verifier/5` | frozen historical authority |
| `berm.handle_verifier/6`, `/7` | unapproved historical candidates, superseded |
| `berm.external_account_binding.x/1` | method carried by the founder-pinned R13-A REISSUE R4 authority; historical |
| **`berm.external_account_binding.x/2`** | **current** — delivered by the founder-pinned R8 implementation checkpoint |

`/2` succeeded `/1` through the R8 lane, which bound the proof line to the
handle (`Berm Protocol: @<handle> permanently binds to <npub> #bermprotocol`) and
extended the vector corpus from 89 to 97.

## Labels that are not versions

- **R13-A REISSUE R4** names a protocol authority reissue.
- **R8** names an implementation lane.
- Neither is a "Berm Protocol version". There is no "Berm Protocol v8".

## Historical documents

Older repository documents that describe predecessor methods or candidate
transports are kept for history and marked superseded. They are not current
authority.
