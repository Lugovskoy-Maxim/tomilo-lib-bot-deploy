const config = require('./config');
const { apiFetch } = require('./personal-notifications');
const { waitForMessageSlot } = require('./message-rate-limiter');

let unsupported = false;

async function fetchPendingReports(fetchApi = apiFetch) {
  const json = await fetchApi('/telegram/bot/pending-reports?limit=10');
  if (!json.success || !Array.isArray(json.data)) throw new Error('Invalid pending-reports response');
  return json.data;
}

async function acknowledge(notificationIds, fetchApi = apiFetch) {
  await fetchApi('/telegram/bot/pending-reports/ack', {
    method: 'POST',
    body: JSON.stringify({ notificationIds }),
  });
}

async function runReportNotifications(bot, dependencies = {}) {
  const activeConfig = dependencies.config || config;
  const fetchApi = dependencies.apiFetch || apiFetch;
  const waitSlot = dependencies.waitForMessageSlot || waitForMessageSlot;
  if (!activeConfig.notifyReports || unsupported) return;
  if (!activeConfig.telegramEnabled || !activeConfig.telegramReportsChatId) return;
  if (!activeConfig.botApiSecret) {
    console.warn('[REPORTS] BOT_API_SECRET не задан — доставка жалоб отключена');
    return;
  }
  let items;
  try {
    items = await fetchPendingReports(fetchApi);
  } catch (error) {
    if (/\s404:/.test(String(error.message))) {
      unsupported = true;
      console.warn('[REPORTS] API ещё не поддерживает очередь жалоб (404)');
      return;
    }
    console.error('[REPORTS] Ошибка загрузки очереди:', error.message);
    return;
  }
  for (const item of items) {
    if (!item.notificationId || !Array.isArray(item.messages) || !item.messages.length) continue;
    try {
      for (const text of item.messages) {
        await waitSlot();
        await bot.sendMessage(activeConfig.telegramReportsChatId, String(text), {
          message_thread_id: activeConfig.telegramReportsThreadId,
          disable_web_page_preview: true,
          disable_notification: true,
        });
      }
      await acknowledge([item.notificationId], fetchApi);
      console.log(`[REPORTS] Sent report ${item.notificationId} to topic ${activeConfig.telegramReportsThreadId}`);
    } catch (error) {
      const message = error?.message ? String(error.message) : String(error);
      console.error(`[REPORTS] Failed report ${item.notificationId}:`, message.slice(0, 180));
    }
  }
}

module.exports = { runReportNotifications };
