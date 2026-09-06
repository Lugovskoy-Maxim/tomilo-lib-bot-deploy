const test = require('node:test');
const assert = require('node:assert/strict');
const { runReportNotifications } = require('./report-notifications');

const activeConfig = {
  notifyReports: true,
  telegramEnabled: true,
  telegramReportsChatId: '-100123',
  telegramReportsThreadId: 3,
  botApiSecret: 'secret',
};

test('sends through bot-deploy and acknowledges only after success', async () => {
  const calls = [];
  const apiFetch = async (path, options) => {
    calls.push({ path, options });
    if (path.endsWith('?limit=10')) {
      return { success: true, data: [{ notificationId: '507f1f77bcf86cd799439011', messages: ['Жалоба'] }] };
    }
    return { success: true };
  };
  const bot = { sendMessage: async (...args) => calls.push({ send: args }) };
  await runReportNotifications(bot, { config: activeConfig, apiFetch, waitForMessageSlot: async () => {} });
  assert.deepEqual(calls[1].send, ['-100123', 'Жалоба', {
    message_thread_id: 3,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    disable_notification: true,
  }]);
  assert.equal(calls[2].path, '/telegram/bot/pending-reports/ack');
});

test('does not acknowledge a Telegram failure', async () => {
  const paths = [];
  const apiFetch = async (path) => {
    paths.push(path);
    return { success: true, data: [{ notificationId: '507f1f77bcf86cd799439011', messages: ['Жалоба'] }] };
  };
  const bot = { sendMessage: async () => { throw new Error('Telegram unavailable'); } };
  await runReportNotifications(bot, { config: activeConfig, apiFetch, waitForMessageSlot: async () => {} });
  assert.deepEqual(paths, ['/telegram/bot/pending-reports?limit=10']);
});
