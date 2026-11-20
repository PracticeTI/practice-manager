# Product commitments: free and paid

Status: **draft for review** · Last updated: 2026-11-20

These are promises about the product, not licence terms. The licence grants rights in the code and
cannot bind a future maintainer's pricing, so the commitments below are policy — they bind the
maintainers. The grant itself, and what the licence does and does not reach, is in
[licensing.md](licensing.md).

The rule: **we charge for who operates the software, never for what the software does.**

Practices pay for someone to run, patch, back up, answer the phone and take responsibility. They
do not pay for the ability to treat a patient safely or to get their own data back.

## Free, permanently

Everything in the core application, including:

- Clinical records, case notes, appointments, forms, outcome measures, reports
- Invoicing and payment tracking
- Secure patient file storage and access control
- Audit log, role management, encryption
- Complete data export, in documented formats, at any time
- Self-hosting, for any number of practitioners in a practice
- Every AI feature, switched off by default and fully disableable

## Paid, optional

| Service | What is actually being sold |
|---|---|
| Managed hosting | Infrastructure in Australian data centres, patching, monitoring, backups, disaster recovery, uptime commitment |
| Support and onboarding | A person who answers, setup, training, data migration |
| Promote to hosted | The migration service itself |
| Multi-site and enterprise | SSO, consolidation across locations, cross-site reporting |

## Three tests for any future change

1. **Safety test** — could a clinician treat a patient safely using only the free tier?
2. **Exit test** — could a practice leave completely, with every record, without paying us?
3. **Distance test** — is the paid difference describable as "we operate it for you" or "we
   answer the phone", rather than "we removed this from the free version"?

If a proposal fails any of them, it is not a paid feature; it is a broken promise.

## What we will never do

- Sell, rent or share patient data
- Train AI models on your clinical records
- Charge per patient or per practitioner for the core platform
- Hold your data hostage when you leave
- Put a feature you need for safe care behind a paywall
- Make any AI feature a condition of using the platform

## Operational commitments

- **No phone-home.** Self-hosted installs carry no licence key, no activation, no usage
  telemetry and no callback to our servers. The software runs fully offline.
- **No crippleware.** The self-hosted build runs the same code as the hosted build. Differences
  are in who operates it, not in what it can do.
- **Symmetry.** Migration is a service, not a lock. Promoting Solo to hosted is optional and
  paid; moving hosted back to self-hosted is a supported, documented export that does not
  require our involvement or permission.
- **No ads in clinical surfaces.** Upgrade prompts live in Admin → Settings, are permanently
  dismissible, and never appear while someone is writing notes or reviewing a patient.

## How this rule can change

- Amendments are published as a dated decision record with at least **90 days' notice**.
- Changes apply to future releases only. A feature that was free in a released version stays
  free in that version.
- No mechanism introduced later may retroactively remove export, audit or access control from
  anyone already running the software.
- If the project stops operating, the software continues under the AGPL whether or not
  anyone maintains it. That is the point of the licence.

## Funding and governance

- The core is funded by grants and voluntary contributions; managed hosting and support are the
  commercial services that sustain it.
- No revenue depends on patient data, advertising, data brokering or selling aggregate insights.
- Funding sources and expenditure are published in an annual report.
- The roadmap is prioritised by a council with a majority of practising allied health
  clinicians.

If the project incorporates as a charity or not-for-profit, this section is subject to
confirmation that hosting revenue is compatible with its stated purpose and tax endorsements.
Not-for-profit constrains the distribution of surplus, not the earning of revenue.
