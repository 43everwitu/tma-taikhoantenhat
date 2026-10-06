# Netflix Cookies via nfshop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a customer pays for a "Gói Netflix Cookies" variant, fulfil it automatically through the nfshop integration API and deliver the nfshop order link `/o/{public_id}`.

**Architecture:** nfshop (Python, `~/nfshop`, GitHub `43everwitu/nfshop`) gains lifetime-quota orders, idempotent order creation and an additive `extend` endpoint. This repo gains an nfshop HTTP client, a ledger table and a fulfilment service that listens for `order.backorder_paid`, calls nfshop, then delivers through the existing delivery path. Failures leave the order in backorder and are retried by a sweep.

**Tech Stack:** Node 20 + better-sqlite3 + `node --test` (this repo); Python 3.10 stdlib HTTP server + sqlite3 + `unittest` (nfshop).

**Spec:** `docs/superpowers/specs/2026-10-06-nfshop-netflix-cookies-design.md`

## Global Constraints

- Do NOT commit or push (user rule). nfshop work goes on local branch `feat/lifetime-links-extend` in `~/nfshop`.
- Never call the real nfshop API from tests; never send real Telegram (inject stubs).
- `data/shop.db` is the live DB: every fixture deletes what it inserts in `t.after`; run `node scripts/purge-test-data.js` dry-run → read counts → `--apply`, plus the GLOB sweep from CLAUDE.md, after test stages.
- Use `127.0.0.1` not `localhost` for local inter-process URLs.
- The nfshop link `/o/{public_id}` is a credential: never log it.
- Code/comments in English; customer/admin text in neutral professional Vietnamese ("Bạn"), no "nhé"/"~".
- nfshop: `python3 -m unittest discover -s tests -v` must stay green (baseline 69 tests).
- Deploying nfshop (push/pull/restart on the VPS) and writing `NFSHOP_API_KEY` into `.env` are NOT part of this plan — they need explicit user confirmation afterwards.

## Review Focus

- `link_quota` outside 1..100, or sent for a non-`lifetime_mode` package → 400 (Task N1).
- Extending an already-expired order must start from now, not from the past expiry (Task N2).
- Same `reference` sent twice to `extend` or `POST /orders` must not double-apply (Tasks N1, N2, N3).
- Event + sweep firing for the same TMA order concurrently must create exactly one nfshop order (Task T4).
- nfshop 5xx/timeout after the order was actually created, then retried → no duplicate order (reference idempotency, Tasks N1 + T4).
- nfshop-only columns must not leak into the public variant API; client errors must not contain the API key (Tasks T1, T2).

---

## Part A — nfshop (`~/nfshop`)

### Task N1: Lifetime packages/orders and idempotent create

**Files:**
- Modify: `~/nfshop/webapp/store.py` (schema loop ~line 399; `_package_public` ~1122; `create_package`/`update_package` ~1139/1210; `create_order` ~1291; `_order_public` ~1261; `get_order_customer_details` ~1365; `_record_order_daily_use` ~1729; `_order_daily_usage_from` ~1746)
- Modify: `~/nfshop/webapp/service.py` (`create_link_for_order` ~199)
- Test: `~/nfshop/tests/test_orders.py` (new class `LifetimeOrderTests`)

**Interfaces:**
- Produces: `Store.create_package(name, max_link_generations, tier, default_valid_days, actor, lifetime_mode=None)`; `Store.update_package(..., actor, lifetime_mode=None)` (None keeps current); package dict key `lifetime_mode: bool`; `Store.create_order(package_id, valid_days=None, external_reference="", actor="", starts_at=None, expires_at=None, link_quota=None, idempotent=False)`; order dict keys `lifetime_generation_limit: int|None` and (only when an existing order is returned for a repeated reference) `reused: True`.

- [ ] **Step 1: Create branch and write failing tests**

```bash
cd ~/nfshop && git checkout -b feat/lifetime-links-extend
```

Append to `tests/test_orders.py` (before the `if __name__` block if present, else at end):

```python
class LifetimeOrderTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = Store(Path(self.tmp.name) / "lifetime.db")
        self.store.add_cookie(cookie("life"), {"quality": "UHD"})
        self.links = self.store.create_package("Link", 5, "premium", 7, "t", lifetime_mode=True)
        self.monthly = self.store.create_package("Monthly", 5, "premium", 30, "t")

    def tearDown(self):
        self.tmp.cleanup()

    def test_package_exposes_lifetime_mode_and_defaults_to_false(self):
        self.assertTrue(self.links["lifetime_mode"])
        self.assertFalse(self.monthly["lifetime_mode"])
        updated = self.store.update_package(self.monthly["id"], "Monthly", 5, "premium", 30, "t")
        self.assertFalse(updated["lifetime_mode"])
        flipped = self.store.update_package(self.monthly["id"], "Monthly", 5, "premium", 30, "t", lifetime_mode=True)
        self.assertTrue(flipped["lifetime_mode"])

    def test_lifetime_order_defaults_to_one_link_and_uses_lifetime_quota(self):
        order = self.store.create_order(self.links["id"], actor="t")
        self.assertEqual(order["lifetime_generation_limit"], 1)
        self.assertEqual(order["daily_generation_limit"], 1)
        self.assertEqual(order["remaining_generations"], 1)
        order3 = self.store.create_order(self.links["id"], actor="t", link_quota=3)
        self.assertEqual(order3["lifetime_generation_limit"], 3)
        self.assertEqual(order3["remaining_generations"], 3)

    def test_link_quota_is_validated(self):
        for bad in (0, 101, -1, "2", True, 1.5):
            with self.assertRaises(StoreError, msg=repr(bad)):
                self.store.create_order(self.links["id"], actor="t", link_quota=bad)
        with self.assertRaises(StoreError):
            self.store.create_order(self.monthly["id"], actor="t", link_quota=2)

    def test_lifetime_quota_blocks_after_limit_and_ignores_daily_table(self):
        order = self.store.create_order(self.links["id"], actor="t", link_quota=2)
        for _ in range(2):
            self.store.record_order_generation(order["id"], order["cookie_id"], "pc")
        with self.assertRaises(StoreConflict) as ctx:
            self.store.record_order_generation(order["id"], order["cookie_id"], "pc")
        self.assertIn("lượt tạo link", str(ctx.exception))
        after = self.store.get_order(order["id"])
        self.assertEqual(after["generation_count"], 2)
        self.assertEqual(after["remaining_generations"], 0)
        con = self.store._connect()
        try:
            rows = con.execute("SELECT COUNT(*) AS n FROM order_daily_usage WHERE order_id = ?", (order["id"],)).fetchone()
        finally:
            con.close()
        self.assertEqual(rows["n"], 0)

    def test_idempotent_create_reuses_order_for_same_reference(self):
        first = self.store.create_order(self.links["id"], external_reference="tma-1", actor="t", idempotent=True)
        second = self.store.create_order(self.links["id"], external_reference="tma-1", actor="t", idempotent=True)
        self.assertEqual(first["id"], second["id"])
        self.assertTrue(second.get("reused"))
        self.assertNotIn("reused", first)
        self.assertEqual(len(self.store.list_orders()), 1)

    def test_non_idempotent_create_keeps_allowing_duplicate_references(self):
        self.store.create_order(self.links["id"], external_reference="dup", actor="t")
        self.store.create_order(self.links["id"], external_reference="dup", actor="t")
        self.assertEqual(len(self.store.list_orders()), 2)
```

- [ ] **Step 2: Run to verify failure**

Run: `cd ~/nfshop && python3 -m unittest tests.test_orders.LifetimeOrderTests -v`
Expected: FAIL/ERROR (`create_package() got an unexpected keyword argument 'lifetime_mode'`).

- [ ] **Step 3: Implement store changes**

1. In the `for table, column, definition in (...)` loop add:
```python
                    ("packages", "lifetime_mode", "INTEGER NOT NULL DEFAULT 0"),
                    ("orders", "lifetime_generation_limit", "INTEGER"),
```
2. `_package_public`: add `"lifetime_mode": bool(row["lifetime_mode"]),` after `"default_valid_days"`.
3. Add helper next to `_validate_package`:
```python
    @staticmethod
    def _clean_lifetime_mode(value, default):
        if value is None:
            return default
        if not isinstance(value, bool):
            raise StoreError("lifetime_mode phải là true hoặc false.")
        return value
```
4. `create_package(self, name, max_link_generations, tier, default_valid_days, actor, lifetime_mode=None)`: after `_validate_package` call add `lifetime = int(self._clean_lifetime_mode(lifetime_mode, False))`; change INSERT to
`"INSERT INTO packages (name, max_link_generations, priority_quality, tier, default_valid_days, lifetime_mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"` with params `(name, max_link_generations, priority_quality, tier, default_valid_days, lifetime, stamp, stamp)`.
5. `update_package(..., actor, lifetime_mode=None)`: `lifetime = None if lifetime_mode is None else int(self._clean_lifetime_mode(lifetime_mode, False))`; UPDATE becomes
`"UPDATE packages SET name = ?, max_link_generations = ?, priority_quality = ?, tier = ?, default_valid_days = ?, lifetime_mode = COALESCE(?, lifetime_mode), updated_at = ? WHERE id = ?"` params `(name, max_link_generations, priority_quality, tier, default_valid_days, lifetime, now_iso(), package_id)`.
6. `create_order` — replace the signature and the section from `package = self._package_row(...)` through the INSERT:
```python
    def create_order(self, package_id, valid_days=None, external_reference="", actor="", starts_at=None, expires_at=None, link_quota=None, idempotent=False):
        with self._lock:
            con = self._connect()
            try:
                con.execute("BEGIN IMMEDIATE")
                reference = (external_reference or "").strip()
                if len(reference) > 120:
                    raise StoreError("Mã tham chiếu tối đa 120 ký tự.")
                if idempotent and reference:
                    existing = con.execute(
                        "SELECT * FROM orders WHERE external_reference = ? ORDER BY id DESC LIMIT 1", (reference,)
                    ).fetchone()
                    if existing is not None:
                        public = self._order_public(existing, con)
                        public["reused"] = True
                        con.commit()
                        return public
                package = self._package_row(con, package_id)
                if package["tier"] not in ("premium", "standard"):
                    raise StoreError("Gói cũ cần chọn Premium hoặc Standard trước khi tạo đơn.")
                days = package["default_valid_days"] if valid_days is None else valid_days
                if not isinstance(days, int) or not 1 <= days <= 365:
                    raise StoreError("Số ngày hiệu lực phải từ 1 đến 365.")
                lifetime_limit = None
                if package["lifetime_mode"]:
                    quota = 1 if link_quota is None else link_quota
                    if isinstance(quota, bool) or not isinstance(quota, int) or not 1 <= quota <= 100:
                        raise StoreError("Số lượt link phải từ 1 đến 100.")
                    lifetime_limit = quota
                elif link_quota is not None:
                    raise StoreError("Chỉ gói theo lượt mới nhận số lượt link.")
                cookie = self._pick_order_cookie(con, package["priority_quality"])
```
   (the original `reference = ...`/len check lines and the old `days` lines are removed because they now appear above; keep everything from `if cookie is None:` onward unchanged except the INSERT.) INSERT becomes:
```python
                            "INSERT INTO orders (public_id, package_id, package_name, max_link_generations, priority_quality, tier, cookie_id, starts_at, expires_at, created_at, updated_at, external_reference, lifetime_generation_limit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                            (public_id, package["id"], package["name"], package["max_link_generations"], package["priority_quality"], package["tier"], cookie["id"], starts, expires, stamp, stamp, reference, lifetime_limit),
```
7. `_order_public`: add `"lifetime_generation_limit": row["lifetime_generation_limit"],` after `"tier"`.
8. `get_order_customer_details` return dict: add `"lifetime_generation_limit": order["lifetime_generation_limit"],`.
9. `_order_daily_usage_from`: directly after `order = self._order_row(con, order_id)` insert:
```python
        if order["lifetime_generation_limit"] is not None:
            limit = order["lifetime_generation_limit"]
            used = order["generation_count"]
            return {"used": used, "limit": limit, "remaining": max(0, limit - used), "reset_at": order["expires_at"]}
```
10. `_record_order_daily_use`: first lines of the method:
```python
        if order["lifetime_generation_limit"] is not None:
            if order["generation_count"] >= order["lifetime_generation_limit"]:
                raise StoreConflict(f"Đơn đã dùng hết {order['lifetime_generation_limit']} lượt tạo link.")
            return
```
11. `service.py`: in `create_link_for_order`, replace the `if daily["remaining"] <= 0:` block body with
```python
        if daily["remaining"] <= 0:
            if order.get("lifetime_generation_limit") is not None:
                return 429, {"error": f"Đơn đã dùng hết {daily['limit']} lượt tạo link."}
            plan_name = "Premium" if order["tier"] == "premium" else "Standard"
            return 429, {"error": f"Đơn {plan_name} đã hết {daily['limit']} lượt tạo link hôm nay. Lượt sẽ đặt lại lúc 00:00."}
```
and change `status = 429 if "lượt tạo link hôm nay" in str(exc) else 409` to `status = 429 if "lượt tạo link" in str(exc) else 409`.

- [ ] **Step 4: Run tests**

Run: `cd ~/nfshop && python3 -m unittest tests.test_orders -v 2>&1 | tail -15 && python3 -m unittest discover -s tests 2>&1 | tail -4`
Expected: new tests PASS; full suite `OK` (≥75 tests).

### Task N2: `extend_order`

**Files:**
- Modify: `~/nfshop/webapp/store.py` (add method after `update_order`)
- Test: `~/nfshop/tests/test_orders.py` (class `ExtendOrderTests`)

**Interfaces:**
- Consumes: Task N1 (`lifetime_generation_limit`, `create_order(..., link_quota=)`).
- Produces: `Store.extend_order(order_id, days, add_links, reference, actor) -> order dict`. `days` extends expiry additively from `max(now, expires_at)`; `add_links` increases `lifetime_generation_limit`; idempotent per `(order, reference)`; raises `StoreError` for revoked order, bad ints, missing both, empty/over-long reference, `add_links` on non-lifetime order.

- [ ] **Step 1: Write failing tests**

```python
class ExtendOrderTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = Store(Path(self.tmp.name) / "extend.db")
        self.store.add_cookie(cookie("ext"), {"quality": "UHD"})
        self.monthly = self.store.create_package("Monthly", 5, "premium", 30, "t")
        self.links = self.store.create_package("Link", 5, "premium", 7, "t", lifetime_mode=True)

    def tearDown(self):
        self.tmp.cleanup()

    def test_days_extend_additively_from_current_expiry(self):
        order = self.store.create_order(self.monthly["id"], actor="t")
        extended = self.store.extend_order(order["id"], 30, None, "tma-1", "t")
        expected = (datetime.fromisoformat(order["expires_at"]) + timedelta(days=30)).isoformat(timespec="seconds")
        self.assertEqual(extended["expires_at"], expected)

    def test_expired_order_extends_from_now(self):
        past_start = (datetime.now(TZ) - timedelta(days=40)).isoformat(timespec="seconds")
        past_end = (datetime.now(TZ) - timedelta(days=10)).isoformat(timespec="seconds")
        order = self.store.create_order(self.monthly["id"], actor="t", starts_at=past_start, expires_at=past_end)
        self.assertFalse(order["active"])
        extended = self.store.extend_order(order["id"], 30, None, "tma-2", "t")
        delta = datetime.fromisoformat(extended["expires_at"]) - datetime.now(TZ)
        self.assertLess(abs(delta - timedelta(days=30)), timedelta(minutes=1))
        self.assertTrue(extended["active"])

    def test_add_links_increases_lifetime_limit(self):
        order = self.store.create_order(self.links["id"], actor="t", link_quota=1)
        extended = self.store.extend_order(order["id"], None, 2, "tma-3", "t")
        self.assertEqual(extended["lifetime_generation_limit"], 3)
        self.assertEqual(extended["remaining_generations"], 3)

    def test_same_reference_is_applied_once(self):
        order = self.store.create_order(self.links["id"], actor="t", link_quota=1)
        first = self.store.extend_order(order["id"], 5, 2, "tma-4", "t")
        again = self.store.extend_order(order["id"], 5, 2, "tma-4", "t")
        self.assertEqual(again["expires_at"], first["expires_at"])
        self.assertEqual(again["lifetime_generation_limit"], 3)
        other = self.store.extend_order(order["id"], None, 1, "tma-5", "t")
        self.assertEqual(other["lifetime_generation_limit"], 4)

    def test_rejects_invalid_requests(self):
        order = self.store.create_order(self.monthly["id"], actor="t")
        cases = [
            (0, None, "r"), (366, None, "r"), (None, 0, "r"), (None, 101, "r"),
            (True, None, "r"), (None, None, "r"), (30, None, ""), (30, None, "x" * 121),
            (None, 1, "r"),  # add_links on a non-lifetime order
        ]
        for days, add, ref in cases:
            with self.assertRaises(StoreError, msg=repr((days, add, ref))):
                self.store.extend_order(order["id"], days, add, ref, "t")
        self.store.revoke_order(order["id"], "t")
        with self.assertRaises(StoreError):
            self.store.extend_order(order["id"], 30, None, "tma-6", "t")
        with self.assertRaises(StoreError):
            self.store.extend_order(999999, 30, None, "tma-7", "t")
```

- [ ] **Step 2: Run to verify failure**

Run: `cd ~/nfshop && python3 -m unittest tests.test_orders.ExtendOrderTests -v`
Expected: ERROR `AttributeError: ... has no attribute 'extend_order'`.

- [ ] **Step 3: Implement**

Add after `update_order`:

```python
    def extend_order(self, order_id, days, add_links, reference, actor):
        reference = reference.strip() if isinstance(reference, str) else ""
        if not 1 <= len(reference) <= 120:
            raise StoreError("Mã tham chiếu cần từ 1 đến 120 ký tự.")
        for value, label, upper in ((days, "Số ngày", 365), (add_links, "Số lượt", 100)):
            if value is not None and (isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= upper):
                raise StoreError(f"{label} phải từ 1 đến {upper}.")
        if days is None and add_links is None:
            raise StoreError("Cần days hoặc add_links.")
        with self._lock:
            con = self._connect()
            try:
                con.execute("BEGIN IMMEDIATE")
                order = self._order_row(con, order_id)
                if order["revoked_at"]:
                    raise StoreError("Đơn hàng đã bị thu hồi.")
                if add_links is not None and order["lifetime_generation_limit"] is None:
                    raise StoreError("Đơn này không tính theo lượt link.")
                applied = con.execute(
                    "SELECT 1 FROM order_events WHERE order_id = ? AND kind = 'extended' AND message = ?",
                    (order_id, reference),
                ).fetchone()
                if applied is None:
                    updates, values = [], []
                    if days is not None:
                        base = max(datetime.now(TZ), datetime.fromisoformat(order["expires_at"]))
                        updates.append("expires_at = ?")
                        values.append((base + timedelta(days=days)).isoformat(timespec="seconds"))
                    if add_links is not None:
                        updates.append("lifetime_generation_limit = lifetime_generation_limit + ?")
                        values.append(add_links)
                    stamp = now_iso()
                    updates.append("updated_at = ?")
                    values.append(stamp)
                    values.append(order_id)
                    con.execute(f"UPDATE orders SET {', '.join(updates)} WHERE id = ?", values)
                    con.execute(
                        "INSERT INTO order_events (order_id, kind, cookie_id, message, created_at) VALUES (?, 'extended', ?, ?, ?)",
                        (order_id, order["cookie_id"], reference, stamp),
                    )
                    self._audit(con, actor or "system", "order_extend", "order", order_id)
                con.commit()
                return self._order_public(con.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone(), con)
            except Exception:
                con.rollback()
                raise
            finally:
                con.close()
```

- [ ] **Step 4: Run tests**

Run: `cd ~/nfshop && python3 -m unittest tests.test_orders -v 2>&1 | tail -8`
Expected: all PASS.

### Task N3: HTTP routes, docs, customer page label

**Files:**
- Modify: `~/nfshop/webapp/server.py` (`_integration_api` ~line 440-470)
- Modify: `~/nfshop/webapp/static/order-detail.js:53,60`
- Modify: `~/nfshop/docs/api.md`
- Test: `~/nfshop/tests/test_http.py`

**Interfaces:**
- Consumes: Tasks N1–N2.
- Produces (HTTP, header `X-API-Key`): `POST /api/v1/packages` + `PATCH /api/v1/packages/{id}` accept `lifetime_mode` (bool). `POST /api/v1/orders` accepts `link_quota`; returns **201** for a new order, **200** with the existing order when `external_reference` already exists. `POST /api/v1/orders/{id}/extend` body `{days?, add_links?, reference}` → 200 order JSON.

- [ ] **Step 1: Write failing HTTP tests** (add inside `HttpTests`, after `test_integration_package_uses_tier_and_derives_required_quality`)

```python
    def _integration(self, path, payload, method="POST", key="integration-key-123456"):
        headers = {"Content-Type": "application/json"}
        if key:
            headers["X-API-Key"] = key
        status, raw, _ = self.open(path, data=json.dumps(payload).encode(), method=method, headers=headers)
        return status, json.loads(raw) if raw else {}

    def test_integration_lifetime_order_idempotent_create_and_extend(self):
        self.login()
        self.add("lifetime-http")
        status, package = self._integration("/api/v1/packages", {
            "name": "Link Premium", "tier": "premium", "default_valid_days": 7, "lifetime_mode": True,
        })
        self.assertEqual(status, 201, package)
        self.assertTrue(package["lifetime_mode"])
        body = {"package_id": package["id"], "valid_days": 7, "link_quota": 3, "external_reference": "tma-9"}
        status, order = self._integration("/api/v1/orders", body)
        self.assertEqual(status, 201, order)
        self.assertEqual(order["lifetime_generation_limit"], 3)
        status, again = self._integration("/api/v1/orders", body)
        self.assertEqual(status, 200, again)
        self.assertEqual(again["id"], order["id"])
        status, bad = self._integration("/api/v1/orders", {**body, "external_reference": "tma-10", "link_quota": 0})
        self.assertEqual(status, 400, bad)
        path = f"/api/v1/orders/{order['id']}/extend"
        status, extended = self._integration(path, {"add_links": 2, "days": 3, "reference": "tma-11"})
        self.assertEqual(status, 200, extended)
        self.assertEqual(extended["lifetime_generation_limit"], 5)
        self.assertGreater(extended["expires_at"], order["expires_at"])
        status, _ = self._integration(path, {"days": 3, "reference": "tma-12"}, key=None)
        self.assertEqual(status, 401)
        status, _ = self._integration(path, {"days": 0, "reference": "tma-13"})
        self.assertEqual(status, 400)
        status, _ = self._integration("/api/v1/orders/999999/extend", {"days": 3, "reference": "tma-14"})
        self.assertEqual(status, 404)
```

- [ ] **Step 2: Run to verify failure**

Run: `cd ~/nfshop && python3 -m unittest tests.test_http.HttpTests.test_integration_lifetime_order_idempotent_create_and_extend -v`
Expected: FAIL (`lifetime_mode` missing / 404 on extend).

- [ ] **Step 3: Implement routes**

In `_integration_api`:
- packages POST → `store.create_package(data.get("name"), data.get("max_link_generations"), data.get("tier"), data.get("default_valid_days"), "integration", lifetime_mode=data.get("lifetime_mode"))`.
- packages PATCH → `store.update_package(package_id, data.get("name"), data.get("max_link_generations"), data.get("tier"), data.get("default_valid_days"), "integration", lifetime_mode=data.get("lifetime_mode"))`.
- Insert BEFORE the `re.fullmatch(r"/api/v1/orders(?:/(\d+))?", path)` block:
```python
                match = re.fullmatch(r"/api/v1/orders/(\d+)/extend", path)
                if match and method == "POST":
                    self._send(200, store.extend_order(int(match.group(1)), data.get("days"), data.get("add_links"), data.get("reference"), "integration"), "IntegrationOrderExtend")
                    return
```
- Orders POST →
```python
                        order = store.create_order(
                            data.get("package_id"), data.get("valid_days"), data.get("external_reference", ""), "integration",
                            link_quota=data.get("link_quota"), idempotent=True,
                        )
                        self._send(200 if order.pop("reused", False) else 201, order, "IntegrationOrderCreate")
                        return
```

`order-detail.js` line 53: show lifetime wording when `order.lifetime_generation_limit != null`:
```js
      <div class="usage-card"><dt>${order.lifetime_generation_limit != null ? "Lượt còn lại" : "Lượt hôm nay"}</dt><dd>${order.daily_remaining_generations} / ${order.daily_generation_limit}${order.lifetime_generation_limit != null ? "" : `<small> · Reset lúc ${escapeHtml(formatTime(order.daily_reset_at))}</small>`}</dd></div>
```
Line 60: replace `Còn ${payload.remaining_generations} lượt hôm nay.` with `Còn ${payload.remaining_generations} lượt.` only if it would otherwise mislead for lifetime orders — keep daily wording unchanged for daily orders by using `${payload.remaining_generations} lượt${LIFETIME ? "" : " hôm nay"}`; simplest: in the template use a module-level `let lifetimeOrder = false;` set when rendering the order (`lifetimeOrder = order.lifetime_generation_limit != null;`) and reference it at line 60.

`docs/api.md`: under Packages add `lifetime_mode`; under Orders add `link_quota`, idempotent `external_reference` (200 vs 201), and a new `### Extend order` section documenting `POST /api/v1/orders/{id}/extend` body/semantics/idempotency/400 on revoked.

- [ ] **Step 4: Verify**

Run: `cd ~/nfshop && python3 -m unittest discover -s tests 2>&1 | tail -4 && node --check webapp/static/order-detail.js && git diff --check && echo CLEAN`
Expected: `OK`, no node errors, `CLEAN`.

---

## Part B — this repo (`/home/peanut/tma-taikhoantenhat`)

### Task T1: Migrations, variant columns, admin variant fields

**Files:**
- Create: `src/database/migrations/069_nfshop_variants.js`, `src/database/migrations/070_nfshop_orders.js`
- Modify: `src/services/variantService.js` (SELECT lists lines 6/16, `create`, `update` map)
- Modify: `src/api/routes/admin/variants.js` (`variantBody` zod, `shapeVariant`, create/patch handlers)
- Test: `tests/services/variantService.test.js` (add cases), `tests/database/nfshopSchema.test.js` (new)

**Interfaces:**
- Produces: `product_variants.nfshop_package_id INTEGER`, `.nfshop_kind TEXT` (`'monthly'|'links'`), `.nfshop_valid_days INTEGER`; tables `nfshop_orders(id, tma_order_id UNIQUE, user_id, variant_id, nfshop_package_id, nfshop_order_id, public_id, kind, action, created_at)` and `nfshop_fulfillment_attempts(tma_order_id PK, attempts, last_error, gave_up, alerted_at, updated_at)`. `variantService.create/update/getById/listByProduct` read/write `nfshopPackageId`/`nfshopKind`/`nfshopValidDays` (SQL `nfshop_*`).

- [ ] **Step 1: Write failing tests**

`tests/database/nfshopSchema.test.js`:
```js
const assert = require('node:assert');
const test = require('node:test');
const db = require('../../src/database');

test('nfshop columns and tables exist', () => {
  const cols = db.prepare('PRAGMA table_info(product_variants)').all().map(c => c.name);
  for (const c of ['nfshop_package_id', 'nfshop_kind', 'nfshop_valid_days']) assert.ok(cols.includes(c), c);
  const ledger = db.prepare('PRAGMA table_info(nfshop_orders)').all().map(c => c.name);
  for (const c of ['tma_order_id', 'user_id', 'variant_id', 'nfshop_package_id', 'nfshop_order_id', 'public_id', 'kind', 'action']) {
    assert.ok(ledger.includes(c), c);
  }
  const attempts = db.prepare('PRAGMA table_info(nfshop_fulfillment_attempts)').all().map(c => c.name);
  for (const c of ['tma_order_id', 'attempts', 'last_error', 'gave_up', 'alerted_at']) assert.ok(attempts.includes(c), c);
});
```
Add to `tests/services/variantService.test.js` (follow that file's existing fixture/cleanup helper; name the product with the `${Date.now()}_${rand}` suffix pattern and delete variant → product → category in `t.after`):
```js
test('create/update/getById round-trip nfshop fields', (t) => {
  const seed = seedProduct();            // reuse this file's existing product fixture helper
  t.after(() => seed.cleanup());
  const { id } = variantService.create(db, {
    productId: seed.productId, name: 'Cookies Premium', price: 50000, isBackorder: true,
    nfshopPackageId: 7, nfshopKind: 'monthly', nfshopValidDays: 30,
  });
  let v = variantService.getById(db, id);
  assert.strictEqual(v.nfshop_package_id, 7);
  assert.strictEqual(v.nfshop_kind, 'monthly');
  assert.strictEqual(v.nfshop_valid_days, 30);
  variantService.update(db, seed.productId, id, { nfshopKind: 'links', nfshopValidDays: 7, nfshopPackageId: null });
  v = variantService.getById(db, id);
  assert.strictEqual(v.nfshop_package_id, null);
  assert.strictEqual(v.nfshop_kind, 'links');
  assert.strictEqual(v.nfshop_valid_days, 7);
});
```
(If the file has no reusable fixture helper, write one local to the new test that inserts category + product and deletes variants/products/categories in cleanup.)

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/database/nfshopSchema.test.js tests/services/variantService.test.js`
Expected: FAIL (columns missing).

- [ ] **Step 3: Implement**

`069_nfshop_variants.js`:
```js
function up(db) {
  const cols = new Set(db.prepare('PRAGMA table_info(product_variants)').all().map(c => c.name));
  if (!cols.has('nfshop_package_id')) db.exec('ALTER TABLE product_variants ADD COLUMN nfshop_package_id INTEGER');
  if (!cols.has('nfshop_kind')) db.exec('ALTER TABLE product_variants ADD COLUMN nfshop_kind TEXT');
  if (!cols.has('nfshop_valid_days')) db.exec('ALTER TABLE product_variants ADD COLUMN nfshop_valid_days INTEGER');
}

module.exports = { up };
```
`070_nfshop_orders.js`:
```js
function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS nfshop_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tma_order_id INTEGER NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,
      variant_id INTEGER,
      nfshop_package_id INTEGER NOT NULL,
      nfshop_order_id INTEGER NOT NULL,
      public_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      action TEXT NOT NULL DEFAULT 'create',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_nfshop_orders_renewal ON nfshop_orders(user_id, nfshop_package_id, kind, id);
    CREATE TABLE IF NOT EXISTS nfshop_fulfillment_attempts (
      tma_order_id INTEGER PRIMARY KEY,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      gave_up INTEGER NOT NULL DEFAULT 0,
      alerted_at DATETIME,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

module.exports = { up };
```
`variantService.js`: append `, nfshop_package_id, nfshop_kind, nfshop_valid_days` to both SELECT column lists; in `create` add params `nfshopPackageId = null, nfshopKind = null, nfshopValidDays = null`, extend INSERT columns/placeholders (3 more `?`) and `.run(...)` args; add to `update` map: `nfshopPackageId: 'nfshop_package_id', nfshopKind: 'nfshop_kind', nfshopValidDays: 'nfshop_valid_days'`.

`admin/variants.js`: add to `variantBody`:
```js
  nfshopPackageId: z.number().int().positive().nullable().optional(),
  nfshopKind: z.enum(['monthly', 'links']).nullable().optional(),
  nfshopValidDays: z.number().int().min(1).max(365).nullable().optional(),
```
add the same three keys to `shapeVariant` output (`nfshopPackageId: v.nfshop_package_id ?? null`, `nfshopKind: v.nfshop_kind ?? null`, `nfshopValidDays: v.nfshop_valid_days ?? null`) and make sure the create/patch handlers pass them through to `variantService` (read the handlers; they may spread `req.validated`).

- [ ] **Step 4: Leak check + run**

Run: `grep -n "variants" src/api/routes/public.js | head` and read how public variants are shaped. If any mapper spreads the DB row (`...v`), add an explicit omit of `nfshop_package_id/nfshop_kind/nfshop_valid_days`; add an assertion to an existing public API test (or a new `tests/api/publicVariantNoNfshop.test.js` using the existing supertest-style helper in that dir) that `JSON.stringify(response.variants)` does not contain `nfshop`.
Then: `node --test tests/database/nfshopSchema.test.js tests/services/variantService.test.js tests/api`
Expected: PASS.

### Task T2: nfshop HTTP client + config

**Files:**
- Create: `src/services/nfshopClient.js`
- Modify: `src/config.js` (after `RAG_ORDERS_DELIVERED_URL`)
- Test: `tests/services/nfshopClient.test.js`

**Interfaces:**
- Produces: `createClient({baseUrl, apiKey, fetchImpl, timeoutMs, retries, sleep})` → `{ createOrder({packageId, validDays, linkQuota, reference}), extendOrder(orderId, {days, addLinks, reference}), getOrder(id), revokeOrder(id), orderUrl(publicId) }`; `getClient()` (lazy singleton from config); `NfshopError` with `.kind` in `'transient'|'conflict'|'rejected'` and `.status`.

- [ ] **Step 1: Write failing tests**

```js
const assert = require('node:assert');
const test = require('node:test');
const { createClient, NfshopError } = require('../../src/services/nfshopClient');

function res(status, body) {
  return { ok: status >= 200 && status < 300, status, text: async () => (body === undefined ? '' : JSON.stringify(body)) };
}
function make(responses, extra = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  const client = createClient({
    baseUrl: 'https://nf.example/', apiKey: 'k-secret-123', fetchImpl, retries: 2, sleep: async () => {}, timeoutMs: 1000, ...extra,
  });
  return { client, calls };
}

test('createOrder posts JSON with api key header', async () => {
  const { client, calls } = make([res(201, { id: 5, public_id: 'abc' })]);
  const order = await client.createOrder({ packageId: 3, validDays: 7, linkQuota: 2, reference: 'tma-1' });
  assert.strictEqual(order.public_id, 'abc');
  assert.strictEqual(calls[0].url, 'https://nf.example/api/v1/orders');
  assert.strictEqual(calls[0].init.method, 'POST');
  assert.strictEqual(calls[0].init.headers['X-API-Key'], 'k-secret-123');
  assert.deepStrictEqual(JSON.parse(calls[0].init.body), { package_id: 3, valid_days: 7, link_quota: 2, external_reference: 'tma-1' });
});

test('createOrder omits link_quota when not provided', async () => {
  const { client, calls } = make([res(201, { id: 5, public_id: 'abc' })]);
  await client.createOrder({ packageId: 3, validDays: 30, reference: 'tma-2' });
  assert.ok(!('link_quota' in JSON.parse(calls[0].init.body)));
});

test('extendOrder posts to extend path', async () => {
  const { client, calls } = make([res(200, { id: 5 })]);
  await client.extendOrder(5, { days: 30, reference: 'tma-3' });
  assert.strictEqual(calls[0].url, 'https://nf.example/api/v1/orders/5/extend');
  assert.deepStrictEqual(JSON.parse(calls[0].init.body), { days: 30, reference: 'tma-3' });
});

test('5xx is retried then succeeds', async () => {
  const { client, calls } = make([res(503, { error: 'busy' }), res(502, {}), res(200, { id: 1 })]);
  assert.deepStrictEqual(await client.getOrder(1), { id: 1 });
  assert.strictEqual(calls.length, 3);
});

test('5xx beyond retries throws transient', async () => {
  const { client, calls } = make([res(500, {}), res(500, {}), res(500, {})]);
  await assert.rejects(() => client.getOrder(1), (e) => e instanceof NfshopError && e.kind === 'transient' && e.status === 500);
  assert.strictEqual(calls.length, 3);
});

test('network error and timeout are transient', async () => {
  const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
  const { client } = make([new Error('ECONNRESET'), abort, new Error('ECONNRESET')]);
  await assert.rejects(() => client.getOrder(1), (e) => e.kind === 'transient');
});

test('409 is conflict and not retried; 4xx is rejected and not retried', async () => {
  let { client, calls } = make([res(409, { error: 'Không còn cookie live để cấp đơn.' })]);
  await assert.rejects(() => client.createOrder({ packageId: 1, validDays: 7, reference: 'r' }), (e) => e.kind === 'conflict' && e.status === 409);
  assert.strictEqual(calls.length, 1);
  ({ client, calls } = make([res(400, { error: 'bad' })]));
  await assert.rejects(() => client.createOrder({ packageId: 1, validDays: 7, reference: 'r' }), (e) => e.kind === 'rejected' && e.status === 400 && e.message === 'bad');
  assert.strictEqual(calls.length, 1);
});

test('missing config is rejected without calling fetch; errors never contain the api key', async () => {
  const { client, calls } = make([], { apiKey: '' });
  await assert.rejects(() => client.getOrder(1), (e) => e.kind === 'rejected');
  assert.strictEqual(calls.length, 0);
  const { client: c2 } = make([new Error('boom k-secret-123')]);
  await assert.rejects(() => c2.getOrder(1), (e) => !e.message.includes('k-secret-123'));
});

test('orderUrl strips trailing slash', () => {
  const { client } = make([]);
  assert.strictEqual(client.orderUrl('abc'), 'https://nf.example/o/abc');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/services/nfshopClient.test.js` → Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`src/config.js` — add inside the exported object:
```js
    // nfshop (Netflix cookies fulfilment) integration API.
    NFSHOP_API_URL: process.env.NFSHOP_API_URL || '',
    NFSHOP_API_KEY: process.env.NFSHOP_API_KEY || '',
    NFSHOP_TIMEOUT_MS: Math.max(1000, parseInt(process.env.NFSHOP_TIMEOUT_MS, 10) || 10000),
```
`src/services/nfshopClient.js`:
```js
const config = require('../config');

// kind: 'transient' (retry later) | 'conflict' (409, e.g. no live cookie) | 'rejected' (do not retry)
class NfshopError extends Error {
  constructor(message, { status = null, kind = 'rejected' } = {}) {
    super(message);
    this.name = 'NfshopError';
    this.status = status;
    this.kind = kind;
  }
}

function createClient({
  baseUrl = config.NFSHOP_API_URL,
  apiKey = config.NFSHOP_API_KEY,
  fetchImpl = (...args) => fetch(...args),
  timeoutMs = config.NFSHOP_TIMEOUT_MS,
  retries = 2,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const root = String(baseUrl || '').replace(/\/+$/, '');

  async function request(method, path, body) {
    if (!root || !apiKey) throw new NfshopError('nfshop is not configured', { kind: 'rejected' });
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt) await sleep(500 * attempt);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetchImpl(`${root}${path}`, {
          method,
          headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        });
        const text = await res.text();
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch { data = null; }
        if (res.ok) return data;
        const message = (data && data.error) || `HTTP ${res.status}`;
        if (res.status >= 500) {
          lastErr = new NfshopError(message, { status: res.status, kind: 'transient' });
          continue;
        }
        if (res.status === 409) throw new NfshopError(message, { status: 409, kind: 'conflict' });
        throw new NfshopError(message, { status: res.status, kind: 'rejected' });
      } catch (err) {
        if (err instanceof NfshopError && err.kind !== 'transient') throw err;
        if (err instanceof NfshopError) { lastErr = err; continue; }
        const reason = err && err.name === 'AbortError' ? 'timeout' : 'network error';
        lastErr = new NfshopError(`nfshop request failed: ${reason}`, { kind: 'transient' });
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr;
  }

  return {
    createOrder: ({ packageId, validDays, linkQuota, reference }) => request('POST', '/api/v1/orders', {
      package_id: packageId,
      valid_days: validDays,
      ...(linkQuota != null ? { link_quota: linkQuota } : {}),
      external_reference: reference,
    }),
    extendOrder: (orderId, { days, addLinks, reference }) => request('POST', `/api/v1/orders/${orderId}/extend`, {
      ...(days != null ? { days } : {}),
      ...(addLinks != null ? { add_links: addLinks } : {}),
      reference,
    }),
    getOrder: (orderId) => request('GET', `/api/v1/orders/${orderId}`),
    revokeOrder: (orderId) => request('DELETE', `/api/v1/orders/${orderId}`),
    orderUrl: (publicId) => `${root}/o/${publicId}`,
  };
}

let defaultClient = null;
function getClient() {
  if (!defaultClient) defaultClient = createClient();
  return defaultClient;
}

module.exports = { createClient, getClient, NfshopError };
```

- [ ] **Step 4: Run** `node --test tests/services/nfshopClient.test.js` → Expected: all PASS.

### Task T3: Shared `deliverWithAccounts`

**Files:**
- Modify: `src/services/orderService.js` (add method after `manualDeliver`)
- Modify: `src/api/routes/admin/orders.js` (manual-deliver route lines ~579-596)
- Test: `tests/services/orderDeliverWithAccounts.test.js`

**Interfaces:**
- Produces: `orderService.deliverWithAccounts(orderId, accounts: string[], durationDays: number|null)` — sets `status='delivered'`, `delivered_at`, `delivered_keys_json`, and inserts one sold `stock` row per account (`duration_days`, `sold_to=order.user_id`) in a single transaction. Does NOT publish events or notify.

- [ ] **Step 1: Write failing test** (fixture suffix + cleanup per CLAUDE.md)

```js
const assert = require('node:assert');
const test = require('node:test');
const db = require('../../src/database');
const orderService = require('../../src/services/orderService');

const USER_ID = 9990001;

function seed() {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  db.prepare("INSERT OR IGNORE INTO users (telegram_id, full_name) VALUES (?, 'Test')").run(USER_ID);
  const cat = db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)').run(`Deliver cat ${suffix}`, `deliver-cat-${suffix}`);
  const prod = db.prepare('INSERT INTO products (category_id, name, slug, price, is_active) VALUES (?, ?, ?, 1000, 1)')
    .run(cat.lastInsertRowid, `Deliver product ${suffix}`, `deliver-product-${suffix}`);
  const order = db.prepare(`
    INSERT INTO orders (user_id, product_id, quantity, total_price, payment_code, status, expires_at)
    VALUES (?, ?, 1, 1000, ?, 'paid', datetime('now', '+1 hour'))
  `).run(USER_ID, prod.lastInsertRowid, `DLV${suffix}`);
  return { suffix, categoryId: cat.lastInsertRowid, productId: prod.lastInsertRowid, orderId: order.lastInsertRowid };
}
function cleanup(s) {
  db.prepare('DELETE FROM stock WHERE product_id = ?').run(s.productId);
  db.prepare('DELETE FROM orders WHERE id = ?').run(s.orderId);
  db.prepare('DELETE FROM products WHERE id = ?').run(s.productId);
  db.prepare('DELETE FROM categories WHERE id = ?').run(s.categoryId);
}

test('deliverWithAccounts marks delivered, stores keys and sold stock rows', (t) => {
  const s = seed();
  t.after(() => cleanup(s));
  orderService.deliverWithAccounts(s.orderId, ['https://x/o/abc'], 7);
  const order = db.prepare('SELECT status, delivered_at, delivered_keys_json FROM orders WHERE id = ?').get(s.orderId);
  assert.strictEqual(order.status, 'delivered');
  assert.ok(order.delivered_at);
  assert.deepStrictEqual(JSON.parse(order.delivered_keys_json), ['https://x/o/abc']);
  const rows = db.prepare('SELECT data, duration_days, is_sold, sold_to FROM stock WHERE product_id = ?').all(s.productId);
  assert.deepStrictEqual(rows, [{ data: 'https://x/o/abc', duration_days: 7, is_sold: 1, sold_to: USER_ID }]);
});

test('deliverWithAccounts accepts null duration', (t) => {
  const s = seed();
  t.after(() => cleanup(s));
  orderService.deliverWithAccounts(s.orderId, ['k1', 'k2'], null);
  const rows = db.prepare('SELECT duration_days FROM stock WHERE product_id = ?').all(s.productId);
  assert.strictEqual(rows.length, 2);
  assert.ok(rows.every((r) => r.duration_days === null));
});
```

- [ ] **Step 2: Run** `node --test tests/services/orderDeliverWithAccounts.test.js` → Expected: FAIL (`deliverWithAccounts is not a function`).

- [ ] **Step 3: Implement**

In `orderService.js` after `manualDeliver`:
```js
  /**
   * Mark an order delivered with explicit accounts and record sold stock rows
   * (so the key-expiry reminder sweep can find them). Shared by the admin
   * manual-deliver route and automatic nfshop fulfilment. No events/notify.
   */
  deliverWithAccounts(orderId, accounts, durationDays = null) {
    const order = this.getById(orderId);
    const insertSoldStock = db.prepare(`
      INSERT INTO stock (product_id, variant_id, data, duration_days, is_sold, sold_to, sold_at)
      VALUES (?, ?, ?, ?, 1, ?, CURRENT_TIMESTAMP)
    `);
    db.transaction(() => {
      db.prepare(`UPDATE orders SET status = 'delivered', delivered_at = CURRENT_TIMESTAMP, delivered_keys_json = ? WHERE id = ?`)
        .run(JSON.stringify(accounts), orderId);
      for (const acc of accounts) insertSoldStock.run(order.product_id, order.variant_id ?? null, acc, durationDays, order.user_id);
    })();
  },
```
In `admin/orders.js` manual-deliver: replace the `db.prepare(UPDATE ... delivered_keys_json ...)` statement, and the `insertSoldStock`/`tx` block, with a single call placed AFTER `durationDays` is resolved:
```js
  // Resolve duration: explicit override > variant default > null
  let durationDays = req.validated.durationDays ?? null;
  if (durationDays == null && order.variant_id) {
    const v = db.prepare('SELECT default_duration_days FROM product_variants WHERE id = ?').get(order.variant_id);
    durationDays = v?.default_duration_days ?? null;
  }
  orderService.deliverWithAccounts(orderId, req.validated.accounts, durationDays);
  scheduleTwofaBindingSync(orderId);
```
(keep the `auditService.log` and Telegram notify block untouched; remove only the now-duplicated statements.)

- [ ] **Step 4: Run** `node --test tests/services/orderDeliverWithAccounts.test.js tests/api tests/services/orderRecovery.test.js` → Expected: PASS (existing manual-deliver tests still green).

### Task T4: nfshop fulfilment service

**Files:**
- Create: `src/services/nfshopFulfillmentService.js`
- Test: `tests/services/nfshopFulfillment.test.js`

**Interfaces:**
- Consumes: `nfshopClient.getClient()/NfshopError` (T2), `orderService.deliverWithAccounts` (T3), migration tables (T1), `eventBus`, `adminNotifyService.notify`, `notificationService.sendDelivery`, `orderChannelService.postOrderCard`.
- Produces: `fulfillOrder(orderId, deps?) -> {skipped?, reason?, delivered?, action?, failed?, terminal?}` where `deps = { client, notifyCustomer(order, url, ctx), alertAdmin(text) }` (all default to real implementations); `sweep(deps?)`; `start({bot, client?}) -> stop()`; constants `MAX_ATTEMPTS = 5`, `RETRY_INTERVAL_MS = 180000`, `EVENT_DELAY_MS = 3000`.

Behavior (from spec): variant must have `nfshop_package_id`; order must be `paid`.
- `nfshop_kind='links'` → `createOrder({packageId, validDays: nfshop_valid_days, linkQuota: order.quantity, reference: 'tma-<id>'})`.
- `nfshop_kind='monthly'` → look up latest ledger row for `(user_id, nfshop_package_id, kind='monthly')`; if present `getOrder(row.nfshop_order_id)`: 404/`revoked_at` ⇒ treat as gone; if live ⇒ `extendOrder(id, {days: valid_days*quantity, reference})` (`action='extend'`) else `createOrder({packageId, validDays: valid_days*quantity, reference})`.
- On success, in ONE sqlite transaction: insert `nfshop_orders` row + `orderService.deliverWithAccounts(orderId, [client.orderUrl(public_id)], durationDays)` (monthly: `valid_days*quantity`; links: `valid_days`); then publish `order.delivered`, then `notifyCustomer`.
- Failure: increment attempts, store truncated `last_error`; `rejected` ⇒ `gave_up=1` + alert immediately; else when `attempts >= MAX_ATTEMPTS` ⇒ `gave_up=1` + alert once. Order stays `paid`.
- Per-order in-flight guard so event + sweep never run the same order concurrently.

- [ ] **Step 1: Write failing tests**

```js
const assert = require('node:assert');
const test = require('node:test');
const db = require('../../src/database');
const variantService = require('../../src/services/variantService');
const { NfshopError } = require('../../src/services/nfshopClient');
const svc = require('../../src/services/nfshopFulfillmentService');

const USER_ID = 9990001;
const OTHER_USER_ID = 9991001;

function seed(variants) {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  for (const id of [USER_ID, OTHER_USER_ID]) db.prepare("INSERT OR IGNORE INTO users (telegram_id, full_name) VALUES (?, 'Test')").run(id);
  const cat = db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)').run(`NF cat ${suffix}`, `nf-cat-${suffix}`);
  const prod = db.prepare('INSERT INTO products (category_id, name, slug, price, is_active) VALUES (?, ?, ?, 1000, 1)')
    .run(cat.lastInsertRowid, `NF product ${suffix}`, `nf-product-${suffix}`);
  const ids = {};
  for (const [key, v] of Object.entries(variants)) {
    ids[key] = variantService.create(db, { productId: prod.lastInsertRowid, name: key, price: 1000, isBackorder: true, ...v }).id;
  }
  const state = { suffix, categoryId: cat.lastInsertRowid, productId: prod.lastInsertRowid, variantIds: ids, orderIds: [] };
  state.addOrder = (variantKey, { userId = USER_ID, quantity = 1, status = 'paid' } = {}) => {
    const r = db.prepare(`
      INSERT INTO orders (user_id, product_id, variant_id, quantity, total_price, payment_code, status, expires_at)
      VALUES (?, ?, ?, ?, 1000, ?, ?, datetime('now', '+1 hour'))
    `).run(userId, state.productId, ids[variantKey], quantity, `NF${suffix}${state.orderIds.length}`, status);
    state.orderIds.push(r.lastInsertRowid);
    return r.lastInsertRowid;
  };
  return state;
}
function cleanup(s) {
  const marks = s.orderIds.map(() => '?').join(',') || 'NULL';
  db.prepare(`DELETE FROM nfshop_orders WHERE tma_order_id IN (${marks})`).run(...s.orderIds);
  db.prepare(`DELETE FROM nfshop_fulfillment_attempts WHERE tma_order_id IN (${marks})`).run(...s.orderIds);
  db.prepare('DELETE FROM stock WHERE product_id = ?').run(s.productId);
  db.prepare(`DELETE FROM orders WHERE id IN (${marks})`).run(...s.orderIds);
  db.prepare('DELETE FROM product_variants WHERE product_id = ?').run(s.productId);
  db.prepare('DELETE FROM products WHERE id = ?').run(s.productId);
  db.prepare('DELETE FROM categories WHERE id = ?').run(s.categoryId);
}

function fakeClient(overrides = {}) {
  const calls = [];
  let n = 100;
  const client = {
    calls,
    createOrder: async (args) => { calls.push(['create', args]); n += 1; return { id: n, public_id: `pub${n}` }; },
    extendOrder: async (id, args) => { calls.push(['extend', id, args]); return { id }; },
    getOrder: async (id) => { calls.push(['get', id]); return { id, public_id: `pub${id}`, revoked_at: null }; },
    orderUrl: (p) => `https://nf.test/o/${p}`,
    ...overrides,
  };
  return client;
}
function deps(client) {
  const notified = [];
  const alerts = [];
  return {
    client, notified, alerts,
    notifyCustomer: async (order, url, ctx) => { notified.push({ orderId: order.id, url, ctx }); },
    alertAdmin: async (text) => { alerts.push(text); },
  };
}
const row = (id) => db.prepare('SELECT status, delivered_keys_json FROM orders WHERE id = ?').get(id);

const VARIANTS = {
  monthly: { nfshopPackageId: 11, nfshopKind: 'monthly', nfshopValidDays: 30 },
  links: { nfshopPackageId: 12, nfshopKind: 'links', nfshopValidDays: 7 },
  plain: {},
};

test('links variant creates one order with quota = quantity and delivers the link', async (t) => {
  const s = seed(VARIANTS); t.after(() => cleanup(s));
  const id = s.addOrder('links', { quantity: 3 });
  const d = deps(fakeClient());
  const r = await svc.fulfillOrder(id, d);
  assert.strictEqual(r.delivered, true);
  assert.deepStrictEqual(d.client.calls, [['create', { packageId: 12, validDays: 7, linkQuota: 3, reference: `tma-${id}` }]]);
  assert.strictEqual(row(id).status, 'delivered');
  assert.deepStrictEqual(JSON.parse(row(id).delivered_keys_json), ['https://nf.test/o/pub101']);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM nfshop_orders WHERE tma_order_id = ?').get(id).n, 1);
  assert.strictEqual(db.prepare('SELECT duration_days FROM stock WHERE product_id = ?').get(s.productId).duration_days, 7);
  assert.strictEqual(d.notified.length, 1);
  assert.strictEqual(d.notified[0].url, 'https://nf.test/o/pub101');
});

test('monthly first purchase creates; quantity multiplies days', async (t) => {
  const s = seed(VARIANTS); t.after(() => cleanup(s));
  const id = s.addOrder('monthly', { quantity: 2 });
  const d = deps(fakeClient());
  await svc.fulfillOrder(id, d);
  assert.deepStrictEqual(d.client.calls, [['create', { packageId: 11, validDays: 60, reference: `tma-${id}` }]]);
});

test('monthly renewal by same user extends the existing nfshop order and resends same link', async (t) => {
  const s = seed(VARIANTS); t.after(() => cleanup(s));
  const first = s.addOrder('monthly');
  const d = deps(fakeClient());
  await svc.fulfillOrder(first, d);
  const second = s.addOrder('monthly');
  d.client.calls.length = 0;
  const r = await svc.fulfillOrder(second, d);
  assert.strictEqual(r.action, 'extend');
  assert.deepStrictEqual(d.client.calls, [['get', 101], ['extend', 101, { days: 30, reference: `tma-${second}` }]]);
  assert.deepStrictEqual(JSON.parse(row(second).delivered_keys_json), ['https://nf.test/o/pub101']);
  assert.strictEqual(d.notified[1].ctx.action, 'extend');
});

test('renewal falls back to create when prior order is revoked or gone', async (t) => {
  const s = seed(VARIANTS); t.after(() => cleanup(s));
  const first = s.addOrder('monthly');
  const d = deps(fakeClient());
  await svc.fulfillOrder(first, d);
  d.client.getOrder = async () => ({ id: 101, public_id: 'pub101', revoked_at: '2026-10-01T00:00:00+07:00' });
  const second = s.addOrder('monthly');
  d.client.calls.length = 0;
  const r = await svc.fulfillOrder(second, d);
  assert.strictEqual(r.action, 'create');
  assert.strictEqual(d.client.calls[0][0], 'create');

  d.client.getOrder = async () => { throw new NfshopError('Không tìm thấy đơn hàng.', { status: 404, kind: 'rejected' }); };
  const third = s.addOrder('monthly');
  assert.strictEqual((await svc.fulfillOrder(third, d)).action, 'create');
});

test('other user or other package never extends someone else’s order', async (t) => {
  const s = seed(VARIANTS); t.after(() => cleanup(s));
  const first = s.addOrder('monthly');
  const d = deps(fakeClient());
  await svc.fulfillOrder(first, d);
  const other = s.addOrder('monthly', { userId: OTHER_USER_ID });
  d.client.calls.length = 0;
  assert.strictEqual((await svc.fulfillOrder(other, d)).action, 'create');
  assert.ok(!d.client.calls.some((c) => c[0] === 'extend' || c[0] === 'get'));
});

test('transient failure keeps order paid, counts attempts and alerts once at the limit', async (t) => {
  const s = seed(VARIANTS); t.after(() => cleanup(s));
  const id = s.addOrder('links');
  const d = deps(fakeClient({ createOrder: async () => { throw new NfshopError('down', { status: 503, kind: 'transient' }); } }));
  for (let i = 1; i < svc.MAX_ATTEMPTS; i++) {
    const r = await svc.fulfillOrder(id, d);
    assert.strictEqual(r.failed, true);
    assert.ok(!r.terminal);
  }
  assert.strictEqual(row(id).status, 'paid');
  assert.strictEqual(d.alerts.length, 0);
  const last = await svc.fulfillOrder(id, d);
  assert.strictEqual(last.terminal, true);
  assert.strictEqual(d.alerts.length, 1);
  const a = db.prepare('SELECT attempts, gave_up FROM nfshop_fulfillment_attempts WHERE tma_order_id = ?').get(id);
  assert.deepStrictEqual({ ...a }, { attempts: svc.MAX_ATTEMPTS, gave_up: 1 });
  assert.deepStrictEqual(svc.pendingOrderIds().filter((x) => x === id), []);
});

test('rejected failure gives up immediately and alerts', async (t) => {
  const s = seed(VARIANTS); t.after(() => cleanup(s));
  const id = s.addOrder('links', { quantity: 500 });
  const d = deps(fakeClient({ createOrder: async () => { throw new NfshopError('Số lượt link phải từ 1 đến 100.', { status: 400, kind: 'rejected' }); } }));
  const r = await svc.fulfillOrder(id, d);
  assert.strictEqual(r.terminal, true);
  assert.strictEqual(d.alerts.length, 1);
  assert.strictEqual(row(id).status, 'paid');
});

test('non-nfshop variants and non-paid orders are skipped', async (t) => {
  const s = seed(VARIANTS); t.after(() => cleanup(s));
  const plain = s.addOrder('plain');
  const done = s.addOrder('links', { status: 'delivered' });
  const d = deps(fakeClient());
  assert.strictEqual((await svc.fulfillOrder(plain, d)).reason, 'not_nfshop');
  assert.strictEqual((await svc.fulfillOrder(done, d)).reason, 'not_paid');
  assert.strictEqual(d.client.calls.length, 0);
});

test('concurrent fulfilment of the same order calls nfshop once', async (t) => {
  const s = seed(VARIANTS); t.after(() => cleanup(s));
  const id = s.addOrder('links');
  let release;
  const gate = new Promise((r) => { release = r; });
  const client = fakeClient();
  const original = client.createOrder;
  client.createOrder = async (a) => { await gate; return original(a); };
  const d = deps(client);
  const p1 = svc.fulfillOrder(id, d);
  const p2 = svc.fulfillOrder(id, d);
  release();
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.strictEqual(client.calls.filter((c) => c[0] === 'create').length, 1);
  assert.deepStrictEqual([r1.delivered, r2.reason].sort(), [true, 'in_flight']);
});

test('sweep delivers paid nfshop orders only', async (t) => {
  const s = seed(VARIANTS); t.after(() => cleanup(s));
  const a = s.addOrder('links');
  const b = s.addOrder('plain');
  const d = deps(fakeClient());
  await svc.sweep(d);
  assert.strictEqual(row(a).status, 'delivered');
  assert.strictEqual(row(b).status, 'paid');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/services/nfshopFulfillment.test.js` → Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/services/nfshopFulfillmentService.js`**

```js
const db = require('../database');
const eventBus = require('./eventBus');
const orderService = require('./orderService');
const nfshopClient = require('./nfshopClient');

const MAX_ATTEMPTS = 5;
const RETRY_INTERVAL_MS = 3 * 60 * 1000;
// Let the payment poller send its "order received" message before the link.
const EVENT_DELAY_MS = 3000;

const inFlight = new Set();
let botRef = null;

function getNfshopVariant(order) {
  if (!order.variant_id) return null;
  return db.prepare(`
    SELECT nfshop_package_id, nfshop_kind, nfshop_valid_days
      FROM product_variants WHERE id = ? AND nfshop_package_id IS NOT NULL
  `).get(order.variant_id) || null;
}

function latestMonthlyLedger(userId, packageId) {
  return db.prepare(`
    SELECT nfshop_order_id FROM nfshop_orders
     WHERE user_id = ? AND nfshop_package_id = ? AND kind = 'monthly'
     ORDER BY id DESC LIMIT 1
  `).get(userId, packageId) || null;
}

async function findLiveNfshopOrder(client, nfshopOrderId) {
  try {
    const existing = await client.getOrder(nfshopOrderId);
    return existing && !existing.revoked_at ? existing : null;
  } catch (err) {
    if (err instanceof nfshopClient.NfshopError && err.status === 404) return null;
    throw err;
  }
}

async function callNfshop(client, order, variant) {
  const reference = `tma-${order.id}`;
  const packageId = variant.nfshop_package_id;
  const validDays = variant.nfshop_valid_days;
  if (variant.nfshop_kind === 'links') {
    const created = await client.createOrder({ packageId, validDays, linkQuota: order.quantity, reference });
    return { nfshopOrder: created, action: 'create', durationDays: validDays };
  }
  const days = validDays * order.quantity;
  const prior = latestMonthlyLedger(order.user_id, packageId);
  const live = prior ? await findLiveNfshopOrder(client, prior.nfshop_order_id) : null;
  if (live) {
    await client.extendOrder(live.id, { days, reference });
    return { nfshopOrder: live, action: 'extend', durationDays: days };
  }
  const created = await client.createOrder({ packageId, validDays: days, reference });
  return { nfshopOrder: created, action: 'create', durationDays: days };
}

function recordFailure(orderId, err, deps) {
  const message = String(err && err.message ? err.message : err).slice(0, 200);
  const terminalKind = err && err.kind === 'rejected';
  const current = db.prepare('SELECT attempts FROM nfshop_fulfillment_attempts WHERE tma_order_id = ?').get(orderId);
  const attempts = (current ? current.attempts : 0) + 1;
  const terminal = terminalKind || attempts >= MAX_ATTEMPTS;
  db.prepare(`
    INSERT INTO nfshop_fulfillment_attempts (tma_order_id, attempts, last_error, gave_up, alerted_at, updated_at)
    VALUES (?, ?, ?, ?, CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP END, CURRENT_TIMESTAMP)
    ON CONFLICT(tma_order_id) DO UPDATE SET
      attempts = excluded.attempts, last_error = excluded.last_error, gave_up = excluded.gave_up,
      alerted_at = COALESCE(nfshop_fulfillment_attempts.alerted_at, excluded.alerted_at),
      updated_at = CURRENT_TIMESTAMP
  `).run(orderId, attempts, message, terminal ? 1 : 0, terminal ? 1 : 0);
  if (terminal) {
    Promise.resolve(deps.alertAdmin(
      `⚠️ nfshop không giao được đơn #${orderId} sau ${attempts} lần: ${message}. Cần giao thủ công.`,
    )).catch((e) => console.error('nfshop alertAdmin failed:', e.message));
  }
  return { failed: true, terminal, attempts };
}

async function defaultNotifyCustomer(order, url, ctx) {
  if (!botRef) return;
  const productService = require('./productService');
  const variantService = require('./variantService');
  const orderChannelService = require('./orderChannelService');
  const { sendDelivery } = require('./notificationService');
  const { richifyText } = require('../utils/messages');
  const telegramApiClient = require('./telegramApiClient');
  const product = productService.getById(order.product_id);
  const variant = order.variant_id ? variantService.getById(db, order.variant_id) : null;
  const usageInstructions = product && product.usage_instructions ? richifyText(product.usage_instructions) : '(không có)';
  if (ctx.action === 'extend') {
    await telegramApiClient.sendMessage(order.user_id, 'Gói Netflix Cookies của Bạn đã được gia hạn. Link đơn hàng giữ nguyên bên dưới.');
  }
  await sendDelivery(botRef, { ...order, product_name: product && product.name }, [url], { usageInstructions });
  await orderChannelService.postOrderCard({ order, product, variant, keys: [url] });
}

async function defaultAlertAdmin(text) {
  return require('./adminNotifyService').notify('no_stock', text);
}

async function fulfillOrder(orderId, deps = {}) {
  const client = deps.client || nfshopClient.getClient();
  const notifyCustomer = deps.notifyCustomer || defaultNotifyCustomer;
  const full = { ...deps, alertAdmin: deps.alertAdmin || defaultAlertAdmin };

  if (inFlight.has(orderId)) return { skipped: true, reason: 'in_flight' };
  inFlight.add(orderId);
  try {
    const order = orderService.getById(orderId);
    if (!order || order.status !== 'paid') return { skipped: true, reason: 'not_paid' };
    const variant = getNfshopVariant(order);
    if (!variant) return { skipped: true, reason: 'not_nfshop' };

    let result;
    try {
      result = await callNfshop(client, order, variant);
    } catch (err) {
      return recordFailure(orderId, err, full);
    }

    const url = client.orderUrl(result.nfshopOrder.public_id);
    db.transaction(() => {
      db.prepare(`
        INSERT INTO nfshop_orders (tma_order_id, user_id, variant_id, nfshop_package_id, nfshop_order_id, public_id, kind, action)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(orderId, order.user_id, order.variant_id, variant.nfshop_package_id, result.nfshopOrder.id,
        result.nfshopOrder.public_id, variant.nfshop_kind, result.action);
      orderService.deliverWithAccounts(orderId, [url], result.durationDays);
    })();
    eventBus.publish({ type: 'order.delivered', orderId, status: 'delivered' });
    try {
      await notifyCustomer(orderService.getById(orderId), url, { action: result.action });
    } catch (err) {
      console.error(`nfshop notify failed for order ${orderId}:`, err.message);
    }
    return { delivered: true, action: result.action };
  } finally {
    inFlight.delete(orderId);
  }
}

function pendingOrderIds() {
  return db.prepare(`
    SELECT o.id FROM orders o
      JOIN product_variants v ON v.id = o.variant_id AND v.nfshop_package_id IS NOT NULL
      LEFT JOIN nfshop_fulfillment_attempts a ON a.tma_order_id = o.id
     WHERE o.status = 'paid' AND COALESCE(a.gave_up, 0) = 0
     ORDER BY o.id LIMIT 20
  `).all().map((r) => r.id);
}

async function sweep(deps = {}) {
  for (const id of pendingOrderIds()) {
    try { await fulfillOrder(id, deps); } catch (err) { console.error(`nfshop sweep order ${id}:`, err.message); }
  }
}

function start({ bot, client } = {}) {
  botRef = bot || null;
  const deps = client ? { client } : {};
  const unsubscribe = eventBus.subscribe((event) => {
    if (event.type !== 'order.backorder_paid') return;
    const timer = setTimeout(() => {
      fulfillOrder(event.orderId, deps).catch((err) => console.error(`nfshop fulfil order ${event.orderId}:`, err.message));
    }, EVENT_DELAY_MS);
    timer.unref();
  });
  const interval = setInterval(() => {
    sweep(deps).catch((err) => console.error('nfshop sweep failed:', err.message));
  }, RETRY_INTERVAL_MS);
  interval.unref();
  return function stop() {
    unsubscribe();
    clearInterval(interval);
  };
}

module.exports = { fulfillOrder, sweep, start, pendingOrderIds, MAX_ATTEMPTS, RETRY_INTERVAL_MS, EVENT_DELAY_MS };
```

- [ ] **Step 4: Run** `node --test tests/services/nfshopFulfillment.test.js` → Expected: all PASS. Then sweep leaks (below, Task T5 step 3).

### Task T5: Wire-up, docs, regression, cleanup

**Files:**
- Modify: `src/index.js` (after `keyExpiryReminderService.start(bot)` ~line 181; shutdown handlers ~245/250)
- Modify: `CLAUDE.md` (env/stack note, Shipped sub-projects row)

- [ ] **Step 1: Wire into `index.js`**

After `console.log('⏰ Key expiry reminder armed (daily 09:00 ICT)');` add:
```js
  stopNfshopFulfillment = require('./services/nfshopFulfillmentService').start({ bot });
  console.log('🍿 nfshop fulfilment armed (event + 3 min retry sweep)');
```
Declare `let stopNfshopFulfillment = null;` next to the existing `stopTwofaSync` declaration and call `if (stopNfshopFulfillment) stopNfshopFulfillment();` in the same places `stopTwofaSync` is stopped (read the file to mirror it exactly). Run `node --check src/index.js`.

- [ ] **Step 2: Docs** — in `CLAUDE.md` add: env `NFSHOP_API_URL`, `NFSHOP_API_KEY` (quote the value; use the https URL, remote not localhost), `NFSHOP_TIMEOUT_MS`; a short "nfshop fulfilment" section (variant columns, ledger/attempts tables, `tma-<orderId>` reference, retry/alert rules, never log `/o/` links); a `v0.36-nfshop-cookies` row in Shipped sub-projects.

- [ ] **Step 3: Regression + test-data hygiene**

Run: `node --test tests/ 2>&1 | tail -25`
Expected: no new failures vs. baseline (record any pre-existing failures by stash-free comparison: run `git stash` is forbidden — instead re-run only the failing files and confirm they do not touch nfshop/deliver code).
Then: `node scripts/purge-test-data.js` (dry-run, read counts) → `node scripts/purge-test-data.js --apply` if counts > 0; then the three GLOB sweep SELECTs from CLAUDE.md against `data/shop.db` (use `sqlite3 data/shop.db` or a `node -e` with better-sqlite3); expect 0 rows, and `SELECT COUNT(*) FROM nfshop_orders` / `nfshop_fulfillment_attempts` = 0.

- [ ] **Step 4: Static checks** — `git diff --check`; `node scripts/verify-message-templates.js` (no template changed; must still pass).

### Task T6: Local end-to-end against a local nfshop (no production)

**Files:** none committed (scratch under the session scratchpad).

- [ ] **Step 1:** Read `~/nfshop/README.md` and `webapp/config.py` for the env vars needed to run the server on a temp data dir and a free port (e.g. `127.0.0.1:18080`) with `NFT_INTEGRATION_API_KEY=local-test-key-123456`.
- [ ] **Step 2:** Start it in the background with a temp DB path; via its integration API create two `lifetime_mode` / monthly packages and add one fake live cookie (`quality: UHD`) using the admin/integration cookie route.
- [ ] **Step 3:** Run a scratch Node script using `createClient({ baseUrl: 'http://127.0.0.1:18080', apiKey: 'local-test-key-123456' })`: `createOrder` (links, quota 2) twice with the same reference → same id; `extendOrder` `{days: 30, reference}` twice → single application; `getOrder` shows `lifetime_generation_limit`; confirm `GET /o/{public_id}` renders 200.
- [ ] **Step 4:** Stop the local server, delete its temp data dir. Expected: all assertions hold; report results.

## Handoff (needs user confirmation, not executed here)

1. Deploy nfshop branch: push `feat/lifetime-links-extend`, `ssh greencloudvps 'cd /root/nfshop && git pull && <restart>'` (add the `~/.ssh/config` host alias first; prefer a non-root deploy user).
2. Create the 4 nfshop packages via API; put `NFSHOP_API_URL` / `NFSHOP_API_KEY` in `.env` (quoted), `pm2 delete` + `pm2 start ecosystem.config.cjs --only taikhoantenhat-api` + `pm2 save`.
3. Create product "Gói Netflix Cookies" + 4 backorder variants in the admin UI, then attach `nfshopPackageId`/`nfshopKind`/`nfshopValidDays` via `PATCH` on the variants API.
