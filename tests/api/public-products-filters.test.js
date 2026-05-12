const test = require('node:test');
const assert = require('node:assert');

const API = 'http://localhost:3000/api/v1';

test('GET /products?priceMin=100000 filters by min price', async () => {
  const r = await fetch(`${API}/products?priceMin=100000`);
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.ok(j.data.every((p) => p.price >= 100000));
});

test('GET /products?priceMax=500000 filters by max price', async () => {
  const r = await fetch(`${API}/products?priceMax=500000`);
  const j = await r.json();
  assert.ok(j.data.every((p) => p.price <= 500000));
});

test('GET /products?sort=name_asc orders by name asc', async () => {
  const r = await fetch(`${API}/products?sort=name_asc`);
  const j = await r.json();
  const names = j.data.map((p) => p.name);
  const sorted = [...names].sort((a, b) => a.localeCompare(b, 'vi'));
  assert.deepEqual(names, sorted);
});

test('GET /products?limit=5 returns at most 5 and includes total', async () => {
  const r = await fetch(`${API}/products?limit=5`);
  const j = await r.json();
  assert.ok(j.data.length <= 5);
  assert.ok(typeof j.total === 'number');
  assert.ok(j.total > 0);
});

test('GET /products?limit=5&offset=5 windows correctly', async () => {
  const page1 = await (await fetch(`${API}/products?limit=5&offset=0`)).json();
  const page2 = await (await fetch(`${API}/products?limit=5&offset=5`)).json();
  const ids1 = new Set(page1.data.map((p) => p.id));
  const overlap = page2.data.filter((p) => ids1.has(p.id));
  assert.equal(overlap.length, 0);
});
