# Calendar roadmap

Three layers, kept separate:

1. **Liturgical data providers** — Liturgia Diária (Mass texts, BR usage), LitCal (celebrations/saints).
2. **Rules engine** — `src/modules/calendar/rules/` (own, deterministic, tested).
3. **Presentation & scheduling** — `/calendario`, `/liturgia`, `/agendar liturgia`.

## Implemented and tested (ordinary form)

- Gregorian computus (1583–9999), tested against known Easter dates.
- Movable dates: Ash Wednesday, Palm Sunday, Triduum, Divine Mercy, Ascension (Thursday or Sunday option),
  Pentecost, Trinity, Corpus Christi (Thursday), Sacred Heart, Christ the King, 1st Advent, Holy Family,
  Epiphany (6 Jan or Sunday 2–8 Jan option), Baptism of the Lord (incl. Monday rule when Epiphany is 7/8 Jan).
- Seasons, week numbering (Ordinary Time counted back from Christ the King), Sunday cycle A/B/C, weekday cycle I/II.
- A small fixed set of universal solemnities/feasts.
- Explicit `unsupported` list returned with every day.

## Not yet implemented

- Table of precedence and transfers (e.g. St Joseph / Annunciation in Holy Week, solemnities on Sundays of Advent/Lent/Easter).
- Memorials/feasts of saints in the bot's own engine (today they come from LitCal).
- National overlays: **Brazil** (CNBB: Epiphany, Ascension, Sts Peter & Paul, Assumption, All Saints moved to Sundays —
  to be verified against the current CNBB calendar before coding) and **Portugal**; diocesan propers.
  The option flags `epiphanyOnSunday`/`ascensionOnSunday` exist but no national profile is wired to guild settings yet.
- Portuguese saint names: LitCal has no pt locale; options are contributing a pt translation upstream or maintaining
  a verified local name map keyed by LitCal `event_key`.

## 1962 calendar (separate provider — design)

`Roman1962CalendarProvider` exists and returns `supported: false`. Plan:

- Own data model: classes I–IV, commemorations, octaves of 1962, vigils, Ember days, Rogation days, Septuagesima,
  Sundays after Epiphany/Pentecost (with resumed Sundays), ferias of Lent.
- Rubrics from the _Rubricae generales_ (1960) and the 1962 Missale Romanum; precedence per the 1960 tables.
- Candidate data sources to evaluate: Divinum Officium (data licence to check), LitCal if it adds 1962 support.
- Never reuse ordinary-form rules or the Dancrf API for this calendar. Guild setting `calendarVariant = roman-1962`
  already routes `/calendario` to this provider, which currently answers that it is not available.

## Next milestone

1. Verify live responses of Liturgia Diária v2/v3 and LitCal from production; record new fixtures.
2. Brazil national profile (after verifying CNBB rules) + Portuguese saint names for LitCal `event_key`s.
3. Precedence engine for the ordinary form, then compare day-by-day against LitCal for 10 years.
