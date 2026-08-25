const rawDelay = Number.parseInt(process.env.MESSAGE_COOLDOWN_MS || '2000', 10);
const MESSAGE_COOLDOWN_MS = Math.min(
  60_000,
  Math.max(500, Number.isFinite(rawDelay) ? rawDelay : 2000),
);

let nextSendAt = 0;

/** Общая очередь для Telegram и MAX: сообщения не уходят пачкой. */
async function waitForMessageSlot() {
  const now = Date.now();
  const waitMs = Math.max(0, nextSendAt - now);
  nextSendAt = Math.max(nextSendAt, now) + MESSAGE_COOLDOWN_MS;
  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

module.exports = { waitForMessageSlot, messageCooldownMs: MESSAGE_COOLDOWN_MS };
