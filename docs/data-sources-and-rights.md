# Data sources and rights

This document records what was verified and what was **not**. It is not legal advice; the operator decides.

| Source                                                                                                                                                                    | Used for                                                   | Licence found                                                              | Stored by the bot                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `github.com/Dancrf/biblia-db` (`biblia.json`, rev `c5feefffc2d940efa7b11c49445c52ea1426d6a4`, SHA-256 `ae10ca8d5393ef0af314abe10cc1254d551332df3bbc6e8bd297c19f7add1924`) | Bible text (Matos Soares)                                  | **None in the repository**                                                 | Full text in PostgreSQL after an explicit import by the operator |
| `liturgia.up.railway.app` (`github.com/Dancrf/liturgia-diaria`, docs only)                                                                                                | Daily Mass readings/prayers (Portuguese)                   | **None in the repository**; no published terms of use                      | In-memory cache only; Postgres keeps name/colour/hash            |
| Liturgical Calendar API (`github.com/Liturgical-Calendar/LiturgicalCalendarAPI`)                                                                                          | Saints/celebrations of the day                             | **Apache-2.0** (code and repository data)                                  | In-memory cache only                                             |
| vatican.va — _Catecismo da Igreja Católica_ (Portuguese, 27 pages from `prima-pagina-cic_po.html`, SHA-256 of index+pages `7a309c52…bd23b52` on 2026-10-16)               | Catechism §1-2865                                          | **© Libreria Editrice Vaticana**; no licence for reuse                     | Full text in PostgreSQL after an explicit import by the operator |
| Conferência Episcopal Portuguesa — _Código de Direito Canónico_, updated Portuguese version (2025 PDF `CIC_SiteCEP.pdf`, SHA-256 `6ff916bc…c5afe26`)                      | Canons 1-1752                                              | **© CEP** (Portuguese translation); Latin text © LEV; no licence for reuse | Full text in PostgreSQL after an explicit import by the operator |
| `httpassoca/biblia-matos-soares-api` (link originally supplied)                                                                                                           | —                                                          | Repository not found / not accessible on 2026-10-16                        | —                                                                |
| `bibliacatolica.com.br/biblia-matos-soares-1956/` (reference supplied)                                                                                                    | Not used (blocked from the build environment; no scraping) | —                                                                          | —                                                                |

## Bible — Pe. Manuel de Matos Soares

- The translator died in 1950. Under the general life+70 rule (Portugal and Brazil) his own translation would be in
  the public domain since 2021. However, **the 1956 edition was published posthumously**; revisions, notes or
  typographical arrangements by publishers/editors may carry separate rights, and the digital transcription has no
  licence. **Status: `unverified`.** The import script records this (`--rights-status`), and `/biblia configuracao`
  shows it to admins. Change to `public-domain-verified` or `licensed` only after a real check.
- The text is not committed to this repository (`data/bible/` is git-ignored); operators fetch and import it.
- The source has numbering anomalies (see `data/bible/import-report-*.json` after import); the bot never fills gaps.
- Psalms follow the Vulgate numbering of the edition.

## Catechism and Code of Canon Law

- **Both texts are copyrighted and have no licence for redistribution.** They were added at the operator's request
  for a private, personal-use bot; the operator accepts that risk. Before making the bot public, ask the rights
  holders (LEV for the Catechism; CEP for the Portuguese Code) or set `REFERENCE_TEXTS_ENABLED=false`.
- Safeguards: text is never committed to Git (it is downloaded from the official publishers by
  `npm run references:import`); it is shown only on demand (one paragraph/canon or a range of at most 5);
  every embed names the edition and rights holder and links to the official page (Catechism page on vatican.va,
  or the CEP PDF at the canon's page); `REFERENCE_TEXTS_GUILD_IDS` can limit it to listed servers.
- The Catechism is taken from vatican.va (published by the Holy See), not from third-party PDF copies.
  The Portugal edition already contains the 2018 text of §2267.
- Extraction is validated: the import aborts unless every number 1..2865 / 1..1752 has text exactly once.
  Two numbering typos in the vatican.va source are corrected by position and recorded in the import report:
  "2117" between §2216 and §2218 (→ §2217) and "1439" between §2438 and §2440 (→ §2439). Text is never altered.
- Footnotes of the Catechism are not imported (the "(12)" markers are removed).

## Liturgia Diária

- Readings, prayers and antiphons in liturgical books are typically copyrighted by episcopal conferences/publishers.
  The bot therefore: shows references by default; shows full texts only on explicit request (`/liturgia evangelho`,
  `/liturgia leituras numero:`) or when an admin opts in for the daily post (`leituras: gospel | full`); never persists
  texts; always attributes them to "Liturgia Diária (Dancrf)" and never to Matos Soares.
- It is a community service, not an official Vatican/CNBB endpoint; availability is not guaranteed
  (it did not resolve from the build environment on 2026-10-16).

### Dates outside the provider's coverage (equivalent dates)

- The Liturgia Diária service only has 2024-01-01 to 2027-12-31 (verified 2026-10-16; 3–5 June 2024 are also missing).
- For other dates from 1970 on, `src/modules/liturgy/equivalence/` computes the day's identity in the Brazilian
  calendar (temporal cycle incl. movable feasts; LitCal sanctoral with `epiphany=SUNDAY_JAN2_JAN8&ascension=SUNDAY`;
  Brazilian transfers of Peter & Paul, Assumption, All Saints; Aparecida; Brazilian/Latin-American ranks and proper
  memorials) plus the A/B/C and I/II cycles, and shows the provider's text for a 2024–2027 date with the same
  identity. Nothing is composed; every reply states the source date (`day.equivalent`).
- Validation against the provider itself (scripts kept outside the repo): among 2024–2027 dates sharing a key, 97.4%
  have the same readings; the rest are inconsistencies in the provider's data (e.g. Year I readings in a Year II year).
  On 14 sample years (1970–2100), 97–100% of days have an equivalent; the others (some Ordinary Time Sundays/weeks in
  a given cycle never occur in 2024–2027) are reported as unavailable.
- Before 1970 the previous calendar and lectionary applied; the bot says so and does not apply current rules.

## LitCal

- Apache-2.0. Attribution shown in every saints embed. Test fixture `tests/fixtures/litcal/general-2024-excerpt.json`
  is an excerpt of the project's golden-master test data (Apache-2.0).

## Test fixtures

- `tests/fixtures/bible/*`: synthetic, marked `[SINTÉTICO …]`; the formatter labels them as non-authentic.
- Catechism/Code tests use synthetic HTML/PDF-line fixtures; real-source tests read local copies only when
  `CCC_SOURCE_DIR` / `CIC_SOURCE_PDF` are set.
- `tests/fixtures/liturgia/*`: structure from the public documentation, texts replaced by placeholders.
