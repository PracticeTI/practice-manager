# Licensing and trademark

Status: **draft for review** · Last updated: 2026-11-20

This document states the intellectual-property position of the project: what the licence covers,
what it grants, and what it does not reach. It is written to be read by three audiences at once: a
practitioner deciding whether to trust us with patient records, a contributor deciding whether
their work can be given away, and an operator deciding what they are allowed to do with the
software.

It is not legal advice. The licence text in [LICENSE](../LICENSE) is authoritative. The promises
that sit alongside the licence — what is free, what is paid, and how the project is funded — are in
[product-commitments.md](product-commitments.md). Decisions, with the date each was taken, and
outstanding work are recorded in [roadmap/licensing-decisions.md](roadmap/licensing-decisions.md).

## 1. Scope — what the licence covers

This repository contains code, brand assets and third-party content, and the licence applies to
each differently. Two distinctions do the work: **tracked by git or not**, and **ours or not**.

### Already outside this repository

Customer-specific material is not part of the public tree at all. It lives in the private
overlay, is copied into place by [`scripts/sync-private-overlay.mjs`](../apps/core/scripts/sync-private-overlay.mjs),
and is excluded by [`.gitignore`](../.gitignore) under its private-overlay heading:

| Path | Content |
|------|---------|
| `apps/core/src/private/overlay/public/` | Private domain brand assets |
| `apps/core/src/private/overlay/app/` | Private domain pages and API routes |
| `apps/core/src/lib/privateDomains.js`, `apps/core/src/components/privateLandings.jsx` | Generated overlay bridge modules |
| Other overlay directories | Private domain configuration, tests, scripts and documentation |

`npm run private:check` is the authority: it reads `.private-overlay.json` and fails if any
overlay file is present in the public tree. `npm run private:clean` unmounts the overlay,
leaving a pristine public tree.

Nothing here needs to change for licensing — but these files must not be edited in place, because
the next `npm run private:sync` overwrites them. This mechanism is also the model for any
customer content that turns up elsewhere.

### Tracked, and covered

| Content | Location | Position |
|---------|----------|----------|
| Application source | `apps/core/src/`, `apps/core/scripts/`, `apps/core/test/`, `packages/`, config files | Covered by AGPL-3.0 (section 2) |
| Project and practice names, logos and palettes | Project identity, customer branding | Trademark: the licence grants no rights in any name (section 3) |

### Third-party content, and not ours to license

| Content | Location | Why it cannot be relicensed |
|---------|----------|-----------------------------|
| Provider website captures | `apps/core/public/allied-health/provider-heroes/*.png` — excluded by `.gitignore` | Screenshots of third-party provider websites, captured for the directory |
| Private domain assets | `apps/core/src/private/overlay/public/` | Brand materials and third-party imagery remain outside the public tree |
| Employer and funder logos | `apps/core/public/employers/`, `apps/core/public/funders/` — excluded by `.gitignore` | Company trademarks, plus screenshots of government pricing pages |
| Assessment templates | `apps/core/content/templates/allied-health/OT/` — excluded by `.gitignore` | TAC assessment instruments; the overlay carries the form set privately |

The AGPL grant applies to the code. It cannot grant rights in third-party photographs, program
logos, assessment instruments or customer identities, and this document does not purport to.

**Publication gate:** none of the third-party content above may enter the public tree. Anything
`git add` would pick up has to be relocated to the overlay, or covered by a recorded permission in
a `NOTICE` file, before it ships. Adding the licence does not make those assets licensable.

## 2. Copyright licence — AGPL-3.0-only

The application source is licensed under the **GNU Affero General Public License, version 3, only**
(AGPL-3.0-only), with no additional restrictions. The verbatim licence text is in
[LICENSE](../LICENSE), and both workspace manifests declare `"license": "AGPL-3.0-only"`.

AGPL-3.0 is approved by the Open Source Initiative, so describing the project as "open source"
is accurate in the ordinary, defensible sense — it is the licence used by projects such as
Plausible and Cal.com.

"Only" rather than "or later" is deliberate. It means these terms cannot be replaced by a later
version of the licence without the consent of every contributor — which, without a contributor
licence agreement (see below), means effectively never. For a project whose value proposition
is *the terms cannot be changed on you*, that is a feature. If the project later decides it
wants the option to adopt a future licence revision, that decision has to be made **now** —
after publication it cannot be reversed.

### What AGPL-3.0 allows

- Running the software for any purpose, including clinical and commercial use, without
  conditions and without telling anyone (section 2).
- Reading, auditing, modifying and redistributing the source.
- Charging money for distribution, support, hosting or implementation.
- **Operating it as a hosted service**, including as a competing hosted service. This is
  intended: we compete on service quality, not on withholding the software.

### What AGPL-3.0 requires

- **Conveying** the software (shipping a copy) requires providing the corresponding source and
  preserving notices (sections 4–6).
- **Network use** (section 13): if you modify the program and let other people interact with it
  over a network, you must offer those users the source of *your modified version*. Running an
  unmodified copy carries no such obligation.
- **Appropriate Legal Notices** must be preserved, and an interactive interface must display
  them or offer a way to reach them. For us that is the Source link in the app footer; the
  About → Licences screen is still outstanding (see
  [roadmap/licensing-decisions.md](roadmap/licensing-decisions.md)).

### What AGPL-3.0 does not do

- It does not require anyone to publish patient data, configuration, or their own unrelated
  code.
- It does not stop a competitor from hosting the software.
- It does not require a practice to publish anything about itself.
- It does not replace privacy law. A practice running the software remains responsible for its
  own obligations under the Privacy Act 1988 and the Australian Privacy Principles.

### Contributions

Contributions are accepted under the **Developer Certificate of Origin 1.1** with a `Signed-off-by`
trailer, inbound matching outbound. There is no copyright assignment and no contributor licence
agreement.

That is a deliberate trade. A CLA is the mechanism that lets a project relicense unilaterally;
declining one is what makes the "these terms are fixed" promise credible. The cost is that the
project can never consolidate copyright or move to a different licence. We accept that cost.

Contributors must not contribute code they cannot license, and must flag dependencies whose
licence is incompatible with AGPL-3.0.

### The boundary with paid services

The open source application must remain fully functional without any paid service, and the
proprietary parts of the hosted offering (billing, provisioning, the promotion pipeline) live in
a separate repository and process, communicating over documented APIs.

This is both a licensing boundary — separate processes communicating over documented APIs are
generally treated as separate works — and a product promise: a Solo install that quietly degrades
without a paid control plane would break the free-tier commitment in
[product-commitments.md](product-commitments.md) regardless of what the licence permits.

## 3. Trademark and naming

Copyright and trademark are separate. The licence grants rights in the code; it grants nothing
in any name, logo or palette — neither the maintainers' nor a practice's.

Two consequences apply to every fork and hosted service:

- Do not present a modified version as the official product, or imply endorsement, certification,
  partnership or support by the maintainers.
- A modified version distributed to others must be renamed, and must not reuse the maintainers'
  marks or the branding of any practice running the software.

Mark-specific terms — which names are covered, what is permitted without asking, and what
requires written permission — are maintained by the maintainers outside this repository. They
form no part of the licence grant.

## 4. For practices running the software

- The software is provided **without warranty**, as set out in AGPL-3.0 sections 15–17.
- Compliance with the Privacy Act, the Australian Privacy Principles, professional registration
  requirements and record-retention obligations remains with the practice, regardless of
  whether it self-hosts or uses managed hosting.
- Self-hosting does not make a practice compliant by itself; it changes who operates the
  system, not who is accountable for the records.
- Patient data is owned by the practice and the people it cares for. Nothing in the licence or
  in the paid services changes that.
