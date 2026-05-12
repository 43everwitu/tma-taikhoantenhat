const test = require('node:test');
const assert = require('node:assert');

const API = 'http://localhost:3000/api/v1';

test('GET /categories?exclude=uncategorized hides uncategorized', async () => {
  const r = await fetch(`${API}/categories?exclude=uncategorized`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(Array.isArray(j.data));
  assert.ok(!j.data.some((c) => c.slug === 'uncategorized'));
});

test('GET /categories without exclude returns all', async () => {
  const r = await fetch(`${API}/categories`);
  const j = await r.json();
  assert.ok(j.data.some((c) => c.slug === 'hoc-tap'));
});

test('GET /products?ids=… returns rows in order', async () => {
  const all = await (await fetch(`${API}/products`)).json();
  const ids = all.data.slice(0, 3).map((p) => p.id);
  const reversedIds = [...ids].reverse();
  const r = await fetch(`${API}/products?ids=${reversedIds.join(',')}`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.data.length, 3);
  assert.deepEqual(j.data.map((p) => p.id), reversedIds);
});

test('GET /products?ids= with unknown id silently drops it', async () => {
  const all = await (await fetch(`${API}/products`)).json();
  const realId = all.data[0].id;
  const r = await fetch(`${API}/products?ids=${realId},999999`);
  const j = await r.json();
  assert.equal(j.data.length, 1);
  assert.equal(j.data[0].id, realId);
});

test('GET /products/featured returns up to 8 products', async () => {
  const r = await fetch(`${API}/products/featured`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(Array.isArray(j.data));
  assert.ok(j.data.length <= 8);
});
