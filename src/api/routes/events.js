const { Router } = require('express');
const eventBus = require('../../services/eventBus');

const router = Router();

/**
 * GET /events — Server-Sent Events stream for shop updates.
 * Emits product.create / product.update / product.delete / product.toggle
 * / stock.change / category.update events so customer-facing pages can
 * invalidate their react-query caches and re-render without polling.
 */
router.get('/events', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    // Disable nginx/proxy buffering so events ship immediately.
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  // Initial hello so the client knows the stream is live.
  res.write(`data: ${JSON.stringify({ type: 'connected', at: Date.now() })}\n\n`);

  const send = (event) => {
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch {
      // Connection went away mid-write — cleanup happens on 'close'.
    }
  };

  // Comment frame every 30s keeps the connection alive across proxies that
  // close idle TCP. Browsers ignore "comment" frames (lines starting with `:`).
  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n'); } catch {}
  }, 30000);

  const unsubscribe = eventBus.subscribe(send);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

module.exports = router;
