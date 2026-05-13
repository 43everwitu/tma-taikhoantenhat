const db = require('../database');
const userService = require('./userService');
const eventBus = require('./eventBus');
const { encryptString } = require('../utils/secrets');

const DUPLICATE_WINDOW_SECONDS = 60;

// Prepared statements (compiled once at module load)
const insertOrder = db.prepare(`
  INSERT INTO orders (user_id, product_id, variant_id, quantity, total_price, payment_code, status, source, bank_name, input_value, expires_at, payment_method)
  VALUES (?, ?, ?, ?, ?, '', 'pending', ?, ?, ?, datetime('now', '+' || ? || ' minutes'), ?)
`);
const setPaymentCode = db.prepare(`UPDATE orders SET payment_code = ? WHERE id = ?`);
const reserveStockBatchByVariant = db.prepare(`
  UPDATE stock SET reserved_for_order_id = ?, reserved_at = CURRENT_TIMESTAMP
  WHERE id IN (
    SELECT id FROM stock
    WHERE product_id = ? AND variant_id = ? AND is_sold = 0 AND reserved_for_order_id IS NULL
    LIMIT ?
  )
`);
const reserveStockBatchNoVariant = db.prepare(`
  UPDATE stock SET reserved_for_order_id = ?, reserved_at = CURRENT_TIMESTAMP
  WHERE id IN (
    SELECT id FROM stock
    WHERE product_id = ? AND variant_id IS NULL AND is_sold = 0 AND reserved_for_order_id IS NULL
    LIMIT ?
  )
`);
const releaseReservationsForOrder = db.prepare(`
  UPDATE stock SET reserved_for_order_id = NULL, reserved_at = NULL
  WHERE reserved_for_order_id = ?
`);

const orderService = {
  /**
   * Create a new order with atomic stock reservation. The N stock rows are
   * locked to this order via reserved_for_order_id, so two concurrent orders
   * cannot fight over the same inventory. Reservations are released on
   * cancel/expire (or converted to sold on confirm).
   *
   * Throws Error('INSUFFICIENT_STOCK') if not enough free unreserved stock.
   * Throws Error('DUPLICATE_PENDING') if the same user has a pending order
   * for the same product within DUPLICATE_WINDOW_SECONDS.
   *
   * @param {object} opts - { source?, bankName?, expiryMinutes?, paymentMethod? }
   */
  create(userId, productId, quantity, totalPrice, opts = {}) {
    const source = opts.source || 'telegram';
    const bankName = opts.bankName || null;
    const paymentMethod = opts.paymentMethod || 'bank';
    const variantId = opts.variantId ?? null;
    const encryptedInput = opts.inputValue ? encryptString(String(opts.inputValue)) : null;
    let expiryMinutes = opts.expiryMinutes;
    if (!Number.isFinite(expiryMinutes) || expiryMinutes <= 0) {
      const row = db.prepare("SELECT value FROM settings WHERE key = 'order_expiry_minutes'").get();
      const parsed = parseInt(row?.value, 10);
      expiryMinutes = Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
    }

    // Anti-spam: reject duplicate pending order for same user+product within window.
    // Allow override via opts.allowDuplicate so admin tools can bypass.
    if (!opts.allowDuplicate) {
      const dup = db.prepare(`
        SELECT id FROM orders
        WHERE user_id = ? AND product_id = ? AND status = 'pending'
          AND created_at > datetime('now', '-' || ? || ' seconds')
        LIMIT 1
      `).get(userId, productId, DUPLICATE_WINDOW_SECONDS);
      if (dup) {
        const err = new Error('DUPLICATE_PENDING');
        err.existingOrderId = dup.id;
        throw err;
      }
    }

    const txn = db.transaction(() => {
      const r = insertOrder.run(
        userId, productId, variantId, quantity, totalPrice,
        source, bankName, encryptedInput, expiryMinutes, paymentMethod
      );
      const id = r.lastInsertRowid;
      setPaymentCode.run(`PNS${id}`, id);

      // Reservation: if order has a variant_id, only pull keys with that variant_id.
      // Otherwise pull product-level keys (variant_id IS NULL) to preserve legacy
      // single-SKU semantics.
      const reserved = variantId
        ? reserveStockBatchByVariant.run(id, productId, variantId, quantity)
        : reserveStockBatchNoVariant.run(id, productId, quantity);
      if (reserved.changes < quantity) {
        // Partial reserve happened — explicit release before throw, defensive
        // (transaction rollback should also handle, but explicit is safer).
        releaseReservationsForOrder.run(id);
        const err = new Error('INSUFFICIENT_STOCK');
        err.requested = quantity;
        err.available = reserved.changes;
        throw err;
      }
      return id;
    });

    return this.getById(txn());
  },

  getById(id) {
    return db.prepare(`
      SELECT o.*, p.name as product_name
      FROM orders o
      JOIN products p ON o.product_id = p.id
      WHERE o.id = ?
    `).get(id);
  },

  getByPaymentCode(code) {
    return db.prepare(`
      SELECT o.*, p.name as product_name
      FROM orders o
      JOIN products p ON o.product_id = p.id
      WHERE o.payment_code = ?
    `).get(code);
  },

  getPendingByUser(userId) {
    return db.prepare(`
      SELECT o.*, p.name as product_name
      FROM orders o
      JOIN products p ON o.product_id = p.id
      WHERE o.user_id = ? AND o.status = 'pending'
      ORDER BY o.created_at DESC
    `).all(userId);
  },

  getRecentByUser(userId, limit = 5) {
    return db.prepare(`
      SELECT o.*, p.name as product_name
      FROM orders o
      JOIN products p ON o.product_id = p.id
      WHERE o.user_id = ?
      ORDER BY o.created_at DESC
      LIMIT ?
    `).all(userId, limit);
  },

  /**
   * Confirm payment + deliver — ATOMIC transaction.
   * Prefers reserved stock from this order (the common path: order.create
   * reserved N rows). Falls back to grabbing free stock if reservations were
   * lost (e.g. defensive handling for migrated data).
   *
   * Persists the delivered keys to orders.delivered_keys_json so an admin
   * can resend them later.
   *
   * @returns { success, accounts, error, order }
   */
  confirmAndDeliver: (function() {
    const getOrder = db.prepare(`
      SELECT o.*, p.name as product_name
      FROM orders o JOIN products p ON o.product_id = p.id
      WHERE o.id = ?
    `);
    const getVariantBackorder = db.prepare(
      `SELECT is_backorder FROM product_variants WHERE id = ?`
    );
    const markPaidPending = db.prepare(`
      UPDATE orders SET status = 'paid',
        paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP),
        auto_confirmed = ?
      WHERE id = ?
    `);
    const getReserved = db.prepare(
      `SELECT * FROM stock WHERE reserved_for_order_id = ? AND is_sold = 0 LIMIT ?`
    );
    // Fallback free-stock queries: narrow by variant_id so a variant-bearing
    // order never accidentally siphons keys from a different variant (or the
    // product-level pool). Mirrors the reservation split above.
    const getFreeStockByVariant = db.prepare(
      `SELECT * FROM stock WHERE product_id = ? AND variant_id = ? AND is_sold = 0
       AND (reserved_for_order_id IS NULL OR reserved_for_order_id = ?)
       LIMIT ?`
    );
    const getFreeStockNoVariant = db.prepare(
      `SELECT * FROM stock WHERE product_id = ? AND variant_id IS NULL AND is_sold = 0
       AND (reserved_for_order_id IS NULL OR reserved_for_order_id = ?)
       LIMIT ?`
    );
    const markStockSold = db.prepare(
      `UPDATE stock SET is_sold = 1, sold_to = ?, sold_at = CURRENT_TIMESTAMP,
         reserved_for_order_id = NULL, reserved_at = NULL
       WHERE id = ?`
    );
    const deliverOrder = db.prepare(`
      UPDATE orders SET status = 'delivered',
        paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP),
        delivered_at = CURRENT_TIMESTAMP,
        auto_confirmed = ?,
        delivered_keys_json = ?
      WHERE id = ?
    `);

    const atomicDeliver = db.transaction((orderId, autoConfirmed = 0) => {
      const order = getOrder.get(orderId);
      if (!order) return { success: false, error: 'Đơn hàng không tồn tại' };
      if (order.status !== 'pending' && order.status !== 'paid') {
        return { success: false, error: 'Đơn hàng đã được xử lý' };
      }

      // Back-order variant: mark paid, skip stock + delivery. Admin handles
      // fulfilment via /admin/orders/:id/manual-deliver.
      if (order.variant_id) {
        const v = getVariantBackorder.get(order.variant_id);
        if (v && v.is_backorder) {
          markPaidPending.run(autoConfirmed, orderId);
          return { success: true, backorder: true, order };
        }
      }

      let stock = getReserved.all(orderId, order.quantity);
      if (stock.length < order.quantity) {
        // Reservation incomplete — top up from free pool. Defensive path for
        // legacy orders created before this migration, or if reservations
        // were manually cleared. Variant-aware: never cross-pull from another
        // variant's bucket or from the product-level pool.
        const need = order.quantity - stock.length;
        const variantId = order.variant_id ?? null;
        const extra = variantId
          ? getFreeStockByVariant.all(order.product_id, variantId, orderId, need)
          : getFreeStockNoVariant.all(order.product_id, orderId, need);
        stock = [...stock, ...extra];
        if (stock.length < order.quantity) {
          return { success: false, error: `Không đủ hàng. Chỉ còn ${stock.length} sản phẩm.` };
        }
      }

      for (const item of stock) markStockSold.run(order.user_id, item.id);
      const accounts = stock.map(s => s.data);
      deliverOrder.run(autoConfirmed, JSON.stringify(accounts), orderId);

      return { success: true, accounts, order };
    });

    return function confirmAndDeliver(orderId, autoConfirmed = 0) {
      const r = atomicDeliver(orderId, autoConfirmed);
      if (r.success && r.backorder) {
        eventBus.publish({ type: 'order.backorder_paid', orderId });
      } else if (r.success) {
        eventBus.publish({ type: 'order.delivered', orderId, status: 'delivered' });
      }
      return r;
    };
  })(),

  /**
   * Pay an order using the user's wallet balance. Atomic:
   * deduct balance + confirmAndDeliver. If either fails, rolls back.
   * Returns same shape as confirmAndDeliver, plus { newBalance } on success.
   */
  payFromBalance(orderId) {
    const order = this.getById(orderId);
    if (!order) return { success: false, error: 'Đơn hàng không tồn tại' };
    if (order.status !== 'pending') {
      return { success: false, error: 'Đơn hàng không ở trạng thái chờ thanh toán' };
    }

    const tx = db.transaction(() => {
      // Lock-in the deduction
      const ok = userService.deductBalance(order.user_id, order.total_price);
      if (!ok) throw new Error('INSUFFICIENT_BALANCE');

      // Mark order as wallet-paid before delivery so the audit trail is clear.
      db.prepare(
        `UPDATE orders SET payment_method = 'wallet', paid_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).run(orderId);

      const result = this.confirmAndDeliver(orderId, 1);
      if (!result.success) throw new Error(`DELIVER_FAILED: ${result.error}`);

      const newBalance = db.prepare(
        'SELECT balance FROM users WHERE telegram_id = ?'
      ).get(order.user_id).balance;

      return { ...result, newBalance };
    });

    try {
      return tx();
    } catch (err) {
      if (err.message === 'INSUFFICIENT_BALANCE') {
        return { success: false, error: 'Số dư ví không đủ' };
      }
      if (err.message?.startsWith('DELIVER_FAILED')) {
        return { success: false, error: err.message.replace('DELIVER_FAILED: ', '') };
      }
      throw err;
    }
  },

  /**
   * Mark order as paid (waiting for admin to provide account info).
   * Used when payment matches but stock ran out.
   */
  markPaid(orderId) {
    const order = this.getById(orderId);
    if (!order) return { success: false, error: 'Đơn hàng không tồn tại' };
    if (order.status !== 'pending') return { success: false, error: 'Đơn hàng đã được xử lý' };

    db.prepare(`
      UPDATE orders SET status = 'paid', paid_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(orderId);
    eventBus.publish({ type: 'order.status', orderId, status: 'paid' });

    return { success: true, order };
  },

  manualDeliver(orderId) {
    db.prepare(`
      UPDATE orders SET status = 'delivered', delivered_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(orderId);
    eventBus.publish({ type: 'order.delivered', orderId, status: 'delivered' });
  },

  /**
   * Cancel order — releases stock reservation in same transaction so
   * inventory is freed for other buyers immediately.
   */
  cancel(orderId) {
    const tx = db.transaction(() => {
      const r = db.prepare(
        `UPDATE orders SET status = 'cancelled'
         WHERE id = ? AND status IN ('pending', 'paid')`
      ).run(orderId);
      if (r.changes > 0) releaseReservationsForOrder.run(orderId);
      return r.changes > 0;
    });
    return tx();
  },

  getAllPending() {
    return db.prepare(`
      SELECT o.*, p.name as product_name, u.full_name as user_name
      FROM orders o
      JOIN products p ON o.product_id = p.id
      JOIN users u ON o.user_id = u.telegram_id
      WHERE o.status = 'pending'
      ORDER BY o.created_at ASC
    `).all();
  },

  getActivePending() {
    return db.prepare(`
      SELECT o.*, p.name as product_name
      FROM orders o
      JOIN products p ON o.product_id = p.id
      WHERE o.status = 'pending'
        AND (o.expires_at IS NULL OR o.expires_at > datetime('now'))
      ORDER BY o.created_at ASC
    `).all();
  },

  /**
   * Expire stale orders + release their stock reservations.
   * Returns array of expired order rows (id, user_id, product_id).
   */
  expireStaleOrders() {
    const stale = db.prepare(`
      SELECT id, user_id, product_id FROM orders
      WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at <= datetime('now')
    `).all();

    if (stale.length > 0) {
      const expire = db.prepare("UPDATE orders SET status = 'expired' WHERE id = ?");
      const expireAll = db.transaction(() => {
        for (const order of stale) {
          expire.run(order.id);
          releaseReservationsForOrder.run(order.id);
        }
      });
      expireAll();
    }

    return stale;
  },

  markPaymentMatched(orderId) {
    db.prepare(`
      UPDATE orders SET payment_matched_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(orderId);
  },

  /**
   * Look up the saved keys snapshot for resend. Returns array of strings or
   * null if no snapshot (legacy delivered orders before migration 009).
   */
  getDeliveredKeys(orderId) {
    const row = db.prepare('SELECT delivered_keys_json FROM orders WHERE id = ?').get(orderId);
    if (!row || !row.delivered_keys_json) return null;
    try {
      return JSON.parse(row.delivered_keys_json);
    } catch {
      return null;
    }
  },

  markKeysResent(orderId) {
    db.prepare('UPDATE orders SET delivered_keys_resent_at = CURRENT_TIMESTAMP WHERE id = ?').run(orderId);
  },

  getStats() {
    const totalOrders = db.prepare("SELECT COUNT(*) as c FROM orders WHERE status = 'delivered'").get().c;
    const totalRevenue = db.prepare("SELECT COALESCE(SUM(total_price), 0) as s FROM orders WHERE status = 'delivered'").get().s;
    const pendingOrders = db.prepare("SELECT COUNT(*) as c FROM orders WHERE status = 'pending'").get().c;
    const totalStock = db.prepare('SELECT COUNT(*) as c FROM stock WHERE is_sold = 0').get().c;
    const totalUsers = db.prepare('SELECT COUNT(*) as c FROM users').get().c;

    return { totalOrders, totalRevenue, pendingOrders, totalStock, totalUsers };
  },
};

module.exports = orderService;
