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
  const j = await r.json();
  return j.data.token;
}

async function authed(token, method, path, body) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json() };
}

let token;
let productId;
let createdVariantId;

test('setup: login + pick a product', async () => {
  token = await login();
  assert.ok(token, 'login should return a token');
  const r = await authed(token, 'GET', '/admin/products');
  productId = r.body.data[0].id;
  assert.ok(productId);
});

test('GET variants returns array', async () => {
  const r = await authed(token, 'GET', `/admin/products/${productId}/variants`);
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.data));
});

test('POST creates a variant', async () => {
  const r = await authed(token, 'POST', `/admin/products/${productId}/variants`, {
    name: 'TEST_1_THANG', price: 99000, sortOrder: 10,
  });
  assert.equal(r.status, 201);
  assert.ok(r.body.data.id);
  createdVariantId = r.body.data.id;
});

test('GET shows the new variant', async () => {
  const r = await authed(token, 'GET', `/admin/products/${productId}/variants`);
  const found = r.body.data.find(v => v.name === 'TEST_1_THANG');
  assert.ok(found, 'variant should be in list');
  assert.equal(found.price, 99000);
  assert.equal(found.stock, 0);
});

test('PUT updates the variant', async () => {
  const r = await authed(token, 'PUT', `/admin/products/${productId}/variants/${createdVariantId}`, {
    price: 88000, requiresInput: true, inputLabel: 'Email',
  });
  assert.equal(r.status, 200);
  const list = await authed(token, 'GET', `/admin/products/${productId}/variants`);
  const found = list.body.data.find(v => Number(v.id) === createdVariantId);
  assert.equal(found.price, 88000);
  assert.equal(found.requiresInput, true);
  assert.equal(found.inputLabel, 'Email');
});

test('DELETE soft-deletes the variant', async () => {
  const r = await authed(token, 'DELETE', `/admin/products/${productId}/variants/${createdVariantId}`);
  assert.equal(r.status, 200);
  const list = await authed(token, 'GET', `/admin/products/${productId}/variants`);
  const found = list.body.data.find(v => Number(v.id) === createdVariantId);
  assert.equal(found, undefined);
  const withInactive = await authed(token, 'GET', `/admin/products/${productId}/variants?includeInactive=1`);
  const foundInactive = withInactive.body.data.find(v => Number(v.id) === createdVariantId);
  assert.equal(foundInactive?.isActive, false);
});
