# Data sources and rights

This document records what was verified and what was **not**. It is not legal advice; the operator decides.

| Source                                                                                                                                                                    | Used for                                                   | Licence found                                         | Stored by the bot                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------- |
| `github.com/Dancrf/biblia-db` (`biblia.json`, rev `c5feefffc2d940efa7b11c49445c52ea1426d6a4`, SHA-256 `ae10ca8d5393ef0af314abe10cc1254d551332df3bbc6e8bd297c19f7add1924`) | Bible text (Matos Soares)                                  | **None in the repository**                            | Full text in PostgreSQL after an explicit import by the operator |
| `liturgia.up.railway.app` (`github.com/Dancrf/liturgia-diaria`, docs only)                                                                                                | Daily Mass readings/prayers (Portuguese)                   | **None in the repository**; no published terms of use | In-memory cache only; Postgres keeps name/colour/hash            |
| Liturgical Calendar API (`github.com/Liturgical-Calendar/LiturgicalCalendarAPI`)                                                                                          | Saints/celebrations of the day                             | **Apache-2.0** (code and repository data)             | In-memory cache only                                             |
| `httpassoca/biblia-matos-soares-api` (link originally supplied)                                                                                                           | —                                                          | Repository not found / not accessible on 2026-10-16   | —                                                                |
| `bibliacatolica.com.br/biblia-matos-soares-1956/` (reference supplied)                                                                                                    | Not used (blocked from the build environment; no scraping) | —                                                     | —                                                                |

## Bible — Pe. Manuel de Matos Soares

- The translator died in 1950. Under the general life+70 rule (Portugal and Brazil) his own translation would be in
  the public domain since 2021. However, **the 1956 edition was published posthumously**; revisions, notes or
  typographical arrangements by publishers/editors may carry separate rights, and the digital transcription has no
  licence. **Status: `unverified`.** The import script records this (`--rights-status`), and `/biblia configuracao`
  shows it to admins. Change to `public-domain-verified` or `licensed` only after a real check.
- The text is not committed to this repository (`data/bible/` is git-ignored); operators fetch and import it.
- The source has numbering anomalies (see `data/bible/import-report-*.json` after import); the bot never fills gaps.
- Psalms follow the Vulgate numbering of the edition.

## Liturgia Diária

- Readings, prayers and antiphons in liturgical books are typically copyrighted by episcopal conferences/publishers.
  The bot therefore: shows references by default; shows full texts only on explicit request (`/liturgia evangelho`,
  `/liturgia leituras numero:`) or when an admin opts in for the daily post (`leituras: gospel | full`); never persists
  texts; always attributes them to "Liturgia Diária (Dancrf)" and never to Matos Soares.
- It is a community service, not an official Vatican/CNBB endpoint; availability is not guaranteed
  (it did not resolve from the build environment on 2026-10-16).

## LitCal

- Apache-2.0. Attribution shown in every saints embed. Test fixture `tests/fixtures/litcal/general-2024-excerpt.json`
  is an excerpt of the project's golden-master test data (Apache-2.0).

## Test fixtures

- `tests/fixtures/bible/*`: synthetic, marked `[SINTÉTICO …]`; the formatter labels them as non-authentic.
- `tests/fixtures/liturgia/*`: structure from the public documentation, texts replaced by placeholders.
