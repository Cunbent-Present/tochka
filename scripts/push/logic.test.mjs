import test from 'node:test';
import assert from 'node:assert/strict';
import { hasNoOwnSite, newPlacesInCity } from './logic.mjs';

test('only missing sites and social pages count', () => {
  assert.equal(hasNoOwnSite({ name: 'A' }), true);
  assert.equal(hasNoOwnSite({ website: 'https://vk.com/example' }), true);
  assert.equal(hasNoOwnSite({ website: 'https://example.ru' }), false);
  assert.equal(hasNoOwnSite({ website: 'not a url' }), false);
});

test('new places are deduplicated and limited to selected city', () => {
  const city = { s: 55, n: 56, w: 37, e: 38 };
  const rows = [
    ['n1', 55.5, 37.5, { name: 'New' }],
    ['n1', 55.5, 37.5, { name: 'Duplicate' }],
    ['n2', 55.6, 37.6, { name: 'Known' }],
    ['n3', 55.5, 39, { name: 'Outside' }],
    ['n4', 55.5, 37.5, { name: 'Own site', website: 'https://own.ru' }]
  ];
  assert.deepEqual(newPlacesInCity(rows, new Set(['n2']), city).map(row => row[0]), ['n1']);
});
