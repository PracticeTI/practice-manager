# Licensing decisions

Last updated: 2026-11-20

The positions below are the project's licence and intellectual-property decisions, each recorded
with the date it was taken. The policy they produce is in [../licensing.md](../licensing.md) and
[../product-commitments.md](../product-commitments.md).

This file records *when* each position was adopted, so a later change can be read against what it
replaced rather than appearing without history.

## Decisions

| Date | Decision | Stated in |
|------|----------|-----------|
| 2026-11-10 | AGPL-3.0-only, not "or later" | [licensing.md](../licensing.md) §2 |
| 2026-11-10 | DCO sign-off, no CLA or copyright assignment | [licensing.md](../licensing.md), *Contributions*, and [CONTRIBUTING.md](../../CONTRIBUTING.md) |
| 2026-11-10 | Charge for operating the software, not for clinical function | [product-commitments.md](../product-commitments.md) |
| 2026-11-10 | Third-party and customer assets excluded from the licence grant | [licensing.md](../licensing.md) §1 |
| 2026-11-17 | Mark-specific trademark terms maintained outside this repository; the public document states only the general rule | [licensing.md](../licensing.md) §3 |

## Outstanding work

1. **Licence metadata.** [LICENSE](../../LICENSE) holds the verbatim AGPL-3.0 text and both
   workspace manifests declare `"license": "AGPL-3.0-only"`. The `repository` field is not yet set
   in [package.json](../../package.json).
2. **Legal notices.** The app footer links to the corresponding source. An About → Licences screen
   is still outstanding (AGPL-3.0 section 13, Appropriate Legal Notices).
3. **Contributor sign-off.** [CONTRIBUTING.md](../../CONTRIBUTING.md) carries the DCO 1.1 text and
   the sign-off requirement. No CI check enforces the trailer yet.
