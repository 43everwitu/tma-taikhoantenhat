const test = require('node:test');
const assert = require('node:assert');
require('dotenv').config();

const API = 'http://localhost:3000/api/v1';

async function login() {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: process.env.ADMIN_INITIAL_PASSWORD }),
  });
  return (await r.json()).data.token;
}

test('product detail includes variants[]', async () => {
  const tok = await login();
  const list = await (await fetch(`${API}/products?limit=1`)).json();
  const slug = list.data[0].slug;
  const id = list.data[0].id;

  const created = await fetch(`${API}/admin/products/${id}/variants`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
    body: JSON.stringify({ name: 'V_TEST_PUBLIC', price: 12345 }),
  });
  const cj = await created.json();
  const variantId = cj.data.id;

  const detail = await (await fetch(`${API}/products/${slug}`)).json();
  assert.ok(Array.isArray(detail.data.variants), 'variants must be an array');
  const found = detail.data.variants.find(v => Number(v.id) === variantId);
  assert.ok(found, 'newly-created variant must appear in public detail');
  assert.equal(found.name, 'V_TEST_PUBLIC');
  assert.equal(found.price, 12345);
  assert.equal(found.stock, 0);

  // Cleanup
  await fetch(`${API}/admin/products/${id}/variants/${variantId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${tok}` },
  });
});

test('product without variants returns empty array (not missing)', async () => {
  const list = await (await fetch(`${API}/products?limit=1`)).json();
  const slug = list.data[0].slug;
  const detail = await (await fetch(`${API}/products/${slug}`)).json();
  assert.ok(Array.isArray(detail.data.variants));
});
