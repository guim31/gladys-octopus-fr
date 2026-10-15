// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on every device discovered from realistic
// fixtures: an electricity meter on a peak/off-peak offer, a gas meter, an
// electricity meter on a base offer and one on a Tempo-like offer — in every
// feature-name language.
//
// The table (test/fixtures/gladys-feature-table.json) is extracted from the
// core code: a category/type couple missing there shows as "undefined" or
// without icon in Gladys, a poll frequency outside its list is a 400 on
// discovery, a feature without min/max is a 422 on "Add to Gladys".
// Do not loosen this test to make it pass: fix the integration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fixture } from './helpers/kraken-server.js';
import { CONFIG, createWorld } from './helpers/world.js';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

/** The fixture account, plus a base-offer meter and a Tempo-like meter. */
function account() {
  const answer = fixture('account-hphc.json');
  const data = answer.data.account;
  const [electricity] = data.properties[0].supplyPoints.edges;
  const [hphc] = data.agreements.edges;
  const meter = (id, calendar) => {
    const copy = structuredClone(electricity);
    copy.node.externalIdentifier = id;
    copy.node.meterPoint.providerCalendar = calendar;
    copy.node.meterPoint.offPeakLabel = calendar ? 'HC (22H00-6H00)' : null;
    return copy;
  };
  data.properties.push({
    id: '100002',
    supplyPoints: {
      edges: [
        meter('11111111111111', null),
        meter('22222222222222', {
          id: 'FC_TEMPO',
          temporalClasses: ['HPE', 'HCE', 'HPHI', 'HCHI', 'HPP', 'HCP'].map((code) => ({
            code,
            label: code,
            description: code.startsWith('HC') ? 'de 22h à 6h' : 'de 6h à 22h',
          })),
        }),
      ],
    },
  });
  const base = structuredClone(hphc);
  base.node.supplyPoint.externalIdentifier = '11111111111111';
  base.node.energySupplyRate.rates.edges = [
    {
      node: {
        __typename: 'ElectricitySupplyConsumptionRateType',
        pricePerUnitWithTaxes: '19.40',
        timeSlots: [],
        temporalClass: { code: 'BASE', label: 'Base' },
      },
    },
  ];
  data.agreements.edges.push(base);
  return answer;
}

for (const language of ['en', 'fr', 'de', 'es']) {
  test(`every discovered supply point follows the Gladys rules (${language} names)`, async () => {
    const world = createWorld({
      config: { ...CONFIG, language },
      kraken: { account: account() },
    });
    try {
      await world.connect();
      const devices = world.gladys.fake.discoveredDevices;
      assert.equal(devices.length, 4, 'one device per active supply point');
      const deviceIds = new Set();

      for (const device of devices) {
        const where = device.name;
        assert.ok(!deviceIds.has(device.external_id), `${where}: duplicate device external_id`);
        deviceIds.add(device.external_id);

        // should_poll: true if and only if poll_frequency is provided, in ms.
        if (device.poll_frequency === undefined) {
          assert.notEqual(device.should_poll, true, `${where}: should_poll without poll_frequency`);
        } else {
          assert.equal(device.should_poll, true, `${where}: poll_frequency without should_poll`);
          assert.ok(
            table.poll_frequencies_ms.includes(device.poll_frequency),
            `${where}: poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
          );
        }

        assert.ok(device.features.length > 0, `${where}: no feature`);
        const externalIds = new Set();
        const names = new Set();
        for (const feature of device.features) {
          const at = `${where} / ${feature.name}`;
          const pair = table.pairs[`${feature.category}/${feature.type}`];
          assert.ok(
            pair,
            `${at}: ${feature.category}/${feature.type} is not a couple Gladys knows`,
          );
          assert.ok(
            pair.label_en && pair.label_fr && pair.icon,
            `${at}: couple without label or icon`,
          );

          assert.equal(typeof feature.min, 'number', `${at}: min must be a number`);
          assert.equal(typeof feature.max, 'number', `${at}: max must be a number`);
          assert.ok(
            Number.isFinite(feature.min) && Number.isFinite(feature.max),
            `${at}: finite min/max`,
          );
          assert.ok(feature.min <= feature.max, `${at}: min > max`);
          assert.equal(typeof feature.read_only, 'boolean', `${at}: read_only must be a boolean`);
          assert.equal(
            typeof feature.has_feedback,
            'boolean',
            `${at}: has_feedback must be a boolean`,
          );
          if (feature.unit !== undefined) {
            assert.ok(table.units.includes(feature.unit), `${at}: unknown unit ${feature.unit}`);
            const allowed = table.units_by_category[feature.category];
            if (allowed) {
              assert.ok(
                allowed.flat().includes(feature.unit),
                `${at}: ${feature.unit} not a unit of ${feature.category}`,
              );
            }
          }

          assert.ok(!externalIds.has(feature.external_id), `${at}: duplicate external_id`);
          externalIds.add(feature.external_id);
          assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
          names.add(feature.name);
        }
      }
    } finally {
      await world.stop();
    }
  });
}

test('only electricity feeds the energy tracking, through one daily consumption, never an index', async () => {
  const world = createWorld({ kraken: { account: account() } });
  try {
    await world.connect();
    const consumptionTypes = ['thirty-minutes-consumption', 'daily-consumption'];
    // The core derives a consumption from these: a late index would collapse a day into a half hour.
    const indexTypes = ['index', 'energy'];
    for (const device of world.gladys.fake.discoveredDevices) {
      const energy = device.features.filter((feature) => feature.category === 'energy-sensor');
      assert.equal(
        energy.filter((feature) => indexTypes.includes(feature.type)).length,
        0,
        `${device.name}: a cumulative index`,
      );
      const consumption = energy.filter((feature) => consumptionTypes.includes(feature.type));
      const gas = device.external_id.includes(':gas:');
      assert.equal(consumption.length, gas ? 0 : 1, device.name);
      for (const feature of consumption) {
        assert.equal(feature.type, 'daily-consumption');
        assert.equal(feature.unit, 'kilowatt-hour');
        assert.equal(feature.min, 0, 'a consumption is never negative');
      }
    }
  } finally {
    await world.stop();
  }
});

test('text features carry min/max 0 and every published text is a non-empty string', async () => {
  const world = createWorld();
  try {
    await world.connect();
    await world.addAll();
    for (const device of world.gladys.fake.discoveredDevices) {
      for (const feature of device.features.filter((f) => f.category === 'text')) {
        assert.equal(feature.min, 0);
        assert.equal(feature.max, 0);
      }
    }
    const texts = world.gladys.fake.states.filter((state) => 'text' in state);
    assert.ok(texts.length >= 5);
    for (const state of texts) {
      assert.equal(typeof state.text, 'string');
      assert.ok(state.text.trim().length > 0, state.device_feature_external_id);
    }
  } finally {
    await world.stop();
  }
});
