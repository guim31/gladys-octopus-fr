# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.1] - 2026-10-15

### Added

- Octopus Energy France: sign-in with the e-mail address and password of the
  customer area, one device per supply point (Linky electricity meter,
  Gazpar gas meter) of every account.
- Electricity in the energy tracking of Gladys 5.2: the daily consumption,
  dated on its real day although Enedis sends it a day or two late, with the
  history of your choice (7 days to a year) at the first reading.
- Consumption and cost of the last day read and of the month, account
  balance, next payment and its date, name of the offer, for electricity and
  gas.
- The tariff period of the contract, followed to the minute: off-peak hours
  now, period name, current price per kWh, off-peak ranges (base,
  peak/off-peak and two-season offers; the period only for Tempo-like
  offers).
- Scene triggers _Off-peak hours start_, _Off-peak hours end_ and _New day of
  readings_, and the scene action _Read an Octopus meter summary_.
- The dashboard widget "Octopus Energy".
- A reading every 3 hours by the integration itself, and the _Sign in and
  refresh now_ action.
- Texts and documentation in English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-octopus-fr/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/guim31/gladys-octopus-fr/releases/tag/v1.0.1
