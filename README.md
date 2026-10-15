# Octopus Energy France for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com)
that follows an **Octopus Energy France** contract (electricity and gas,
formerly Plüm Énergie): the Linky and Gazpar consumption Octopus receives
from Enedis and GRDF, its cost, the account balance, the next payment, and
the **off-peak hours** (heures creuses) of the contract, to the minute, to
start the water heater or the car charge at the right time. Electricity feeds
the **energy tracking of Gladys 5.2**, dated on the day it was consumed.

> **Developed without the hardware: feedback welcome.** No Octopus Energy
> France account was available: the GraphQL requests follow the open-source
> Home Assistant integration
> [ha-octopus-french](https://github.com/domodom30/ha-octopus-french) and are
> tested against the answer shapes its code and tests describe, not against
> the live API. Please report what works and what does not in the
> [issues](https://github.com/guim31/gladys-octopus-fr/issues).

## Features

- **One device per supply point**: the electricity meter (Linky, PRM number)
  and the gas meter (Gazpar, PCE number) of every account of the sign-in.
- **Electricity in the energy tracking**: the daily consumption is published
  dated on its real day through the dated-consumption endpoint of Gladys 5.2,
  although Enedis readings arrive a day or two late. The history of your
  choice (7 days to a year) is imported at the first reading.
- **Readings**: consumption and cost of the last day read and of the month
  (the energy cost incl. taxes Octopus computes, standing charge excluded),
  account balance, next payment and its date, name of the offer.
- **Tariff period**, computed every minute from the contract without a
  request: off-peak hours now (yes/no), period name, current price per kWh,
  and the off-peak ranges of the contract. Base, peak/off-peak and two-season
  offers; Tempo-like offers get the period but not the price.
- **Scene triggers**: _Off-peak hours start_ and _Off-peak hours end_ (on the
  minute, once, never at a restart), _New day of readings_ (with its
  figures). **Scene action**: _Read an Octopus meter summary_ (for a message).
- **Dashboard widget** "Octopus Energy": last day and month with their cost,
  the last 14 days as bars, the current period and until when, the price, the
  balance and the next payment.
- A reading of the account every 3 hours by the integration itself, and a
  _Sign in and refresh now_ action.
- Every text in English, French (default), German and Spanish.

## Requirements

- Gladys Assistant **5.2.0** or later (dated consumption for the energy
  tracking, widgets, scene triggers and actions).
- An Octopus Energy **France** customer account (e-mail address and
  password). Octopus UK and the other countries run a different API.
- A Linky or Gazpar meter for the daily consumption.
- Internet access from Gladys (`api.oefr-kraken.energy`).

## Installation

1. In Gladys, open **Integrations** → **Install from GitHub** and enter the
   address of this repository: `https://github.com/guim31/gladys-octopus-fr`
   (or install **Octopus Energy France** from the catalog once it is listed).
2. In **Configuration**, enter the e-mail address and the password of your
   Octopus Energy customer area. Save.
3. Open the **Discover** tab and add the meters. To get the costs computed by
   Gladys, set the electricity meter's _Daily consumption_ as the main meter
   in the energy settings and create your contract there.

The user guide is in [`docs/en.md`](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)); Gladys
links it from the Configuration screen.

## How it works

- Every 3 hours (`src/poller.js`, the container's own timer: Gladys 5.2 does
  not poll external devices reliably, GladysAssistant/Gladys#3198), the
  integration signs in to the Kraken GraphQL API of Octopus Energy France
  (`src/octopus/client.js`: `obtainKrakenToken`, then the refresh token kept
  in `/data` for a week), reads the accounts (supply points, active agreement
  and rates, ledgers, payment forecast) and the daily measurements of each
  meter.
- The days become dated daily consumption (`src/summary.js`) sent with
  `publishEnergyConsumption`; the last three days are sent again every time,
  the core writes only what changed. No cumulative index is published: the
  core's index pipeline would collapse a late day into one half hour.
- A clock ticks every minute (`src/tariff.js`): off-peak ranges from the
  contract's time slots, else the meter's provider calendar, else the Linky
  label; the period is published on change and the off-peak triggers fire on
  the minute.
- The readings go through `publishChangedStates` (changes only, a heartbeat
  every 6 hours). A device added later receives everything at once.
- `scripts/probe.mjs` checks the live API read-only, from a machine with
  Internet: the schema by introspection, a made-up account (a clean refusal
  is expected) and, with a real account in environment variables, counts and
  kinds only, nothing personal.

## Limitations

- **Developed without an account**: the first real sign-ins may find
  differences with the shapes of the reference integration.
- The readings are a day or two late: no live power, no "today".
- The energy tracking receives days: a peak/off-peak contract created in
  Gladys cannot split a day between its two prices (the Octopus cost
  features do).
- Gas is not in the energy tracking (Gladys 5.2 prices electricity only);
  its cost is estimated at the contract's price per kWh.
- Tempo-like offers: no current price nor day colour. Managed offers
  (Octopus Intelligent) are not supported. Read-only: nothing is controlled.

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
node scripts/probe.mjs        # the live API (needs Internet)
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

The tests use the fake Gladys of the SDK (`@gladysassistant/integration-sdk/testing`)
and a fake Kraken API (`test/helpers/kraken-server.js`) answering in the
shapes of `test/fixtures/kraken/`. Nothing reaches the network. See
[`CLAUDE.md`](CLAUDE.md) for the project rules. Versions and releases belong
to the Release workflow (Actions → Release).

## Credits

- [ha-octopus-french](https://github.com/domodom30/ha-octopus-french) by
  domodom30 (MIT): the GraphQL queries, the reading of the agreements, rates,
  ledgers and measurements, the off-peak sources and their order, and the
  answer shapes of the fixtures are adapted from it.
- The handling of late data follows
  [gladys-opower](https://github.com/guim31/gladys-opower); the architecture
  and the conformity tests follow
  [gladys-wled](https://github.com/guim31/gladys-wled) and
  [gladys-subsonic](https://github.com/guim31/gladys-subsonic).

## Disclaimer

This project is not affiliated with, endorsed or sponsored by Octopus Energy.
"Octopus Energy" is a trademark of the Octopus Energy Group; Linky, Gazpar,
Enedis and GRDF are trademarks of their owners.

## License

Apache-2.0
