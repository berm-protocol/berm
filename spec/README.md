# Specification

| File | What it is |
|---|---|
| [`v2.0-architecture.md`](v2.0-architecture.md) | The normative spec. Threat model, identity architecture, data layer, node boundary, conformance checklist, rejected alternatives. |
| [`v2.1-amendment.md`](v2.1-amendment.md) | Thirteen changes on top of v2.0 — key wrapping for multi-device, recovery, guardians, two node bug fixes, measured X paste behaviour. |

**Read v2.0 §0 first.** It describes what v1 got catastrophically wrong and why
the whole thing was redesigned rather than patched. Everything else follows from
that section.

The v2.1 amendment does not replace v2.0. Where they conflict, the amendment
wins and says so explicitly at the top of each section.

## Relationship to the code

The spec is normative; the code is an implementation of it. Where they disagree,
that is a bug in one of them and worth an issue.

`crypto/` implements §3 (identity) and §7 (test vectors). `sdk/` implements §5.4
(the `window.berm` surface). `wordpress/` implements §5 (the node), whose
allowed operations are exhaustively listed in §5.2 — anything a node does beyond
that list is a bug by definition.
