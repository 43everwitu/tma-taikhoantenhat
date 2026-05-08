/**
 * In-process event bus for SSE fan-out. Single instance shared across
 * routes. Subscribers register a callback that receives event objects;
 * the SSE route serializes those to `data: ...\n\n` frames.
 *
 * Single-process only — for multi-instance deploys, swap for Redis pub/sub.
 */
class EventBus {
  constructor() {
    this.subs = new Set();
  }

  subscribe(fn) {
    this.subs.add(fn);
    return () => this.unsubscribe(fn);
  }

  unsubscribe(fn) {
    this.subs.delete(fn);
  }

  publish(event) {
    for (const fn of this.subs) {
      try {
        fn(event);
      } catch (err) {
        console.error('eventBus publish:', err.message);
      }
    }
  }

  size() {
    return this.subs.size;
  }
}

module.exports = new EventBus();
