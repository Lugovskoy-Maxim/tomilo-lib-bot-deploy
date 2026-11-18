const fs = require('node:fs');
const path = require('node:path');

const HOUR = 3600000;
const pct = n => Number.isFinite(n) ? `${n.toFixed(1)}%` : 'нет данных';
const gib = n => Number.isFinite(n) ? `${(n / 1024 ** 3).toFixed(2)} ГБ` : 'нет данных';

async function probe(url, fetcher = fetch) {
  const start = Date.now();
  try {
    const res = await fetcher(url, { signal: AbortSignal.timeout(10000), redirect: 'follow' });
    const ok = res.ok;
    await res.body?.cancel();
    return { ok, ms: Date.now() - start, detail: `HTTP ${res.status}` };
  } catch {
    return { ok: false, ms: Date.now() - start, detail: 'нет ответа / ошибка TLS или сети' };
  }
}

function resourceChecks(metrics, now) {
  if (!metrics || !Number.isFinite(Date.parse(metrics.sampledAt)) ||
      now - Date.parse(metrics.sampledAt) > 90000 || Date.parse(metrics.sampledAt) > now + 10000) {
    return [{ key: 'host-data', label: 'Метрики сервера', ok: false, detail: 'нет свежих данных' }];
  }
  return [
    { key: 'host-data', label: 'Метрики сервера', ok: true, detail: 'актуальны' },
    { key: 'cpu', label: 'CPU', ok: Number.isFinite(metrics.cpu?.usage) && metrics.cpu.usage < 90, detail: pct(metrics.cpu?.usage) },
    { key: 'ram', label: 'RAM', ok: Number.isFinite(metrics.memory?.percentage) && metrics.memory.percentage < 90,
      detail: `${pct(metrics.memory?.percentage)} (${gib(metrics.memory?.used)} / ${gib(metrics.memory?.total)})` },
    { key: 'disk', label: 'Диск', ok: Number.isFinite(metrics.disk?.percentage) && metrics.disk.percentage < 90 && metrics.disk?.available >= 3 * 1024 ** 3,
      detail: `${pct(metrics.disk?.percentage)}, свободно ${gib(metrics.disk?.available)}` },
    { key: 'swap', label: 'Swap', ok: Number.isFinite(metrics.swap?.percentage) && metrics.swap.percentage < 75,
      detail: pct(metrics.swap?.percentage) },
  ];
}

function createMonitor({ bot, config, send = (id, text) => bot.sendMessage(id, text), now = Date.now, fetcher = fetch }) {
  const file = config.monitorStatePath;
  let state = { checks: {}, errors: {}, lastSummary: 0 };
  try { state = { ...state, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  let busy = false;
  let latest = [];
  let hostDetails = [];
  const save = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(state));
    fs.renameSync(`${file}.tmp`, file);
  };
  const chatId = () => config.monitorChatId || state.chatId;
  const deliver = async text => {
    if (!chatId()) return false;
    await send(chatId(), text.slice(0, 4000));
    state.summaryPending = true;
    save();
    return true;
  };
  const summary = () => {
    const checks = Object.fromEntries(latest.map(check => [check.key, check]));
    const status = key => checks[key]?.ok ? '' : '⚠️ ';
    const site = key => {
      const check = checks[key];
      return check ? status(key) + (check.ok ? check.detail.split(', ').at(-1) : check.detail) : '—';
    };
    const errors = Object.values(state.errors).reduce((total, entry) => total + entry.count, 0);
    return [
      '📊 Tomilo · ' + new Date(now()).toLocaleTimeString('ru-RU', {
        timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit',
      }) + ' МСК',
      '',
      `Lib ${site('lib')} · Ani ${site('ani')}`,
      `API ${site('api')} · Ani health ${site('ani-health')}`,
      '',
      ...(checks['host-data']?.ok ? [
        `${status('cpu')}CPU ${checks.cpu.detail} · ${status('ram')}RAM ${checks.ram.detail.split(' (')[0]}`,
        `${status('disk')}Диск ${checks.disk.detail} · ${status('swap')}Swap ${checks.swap.detail}`,
        ...hostDetails,
      ] : ['⚠️ Нет свежих метрик VPS']),
      ...(errors ? [`⚠️ Ошибок бота за период: ${errors}`] : []),
    ].join('\n');
  };
  let queue = Promise.resolve();
  function serialize(work) {
    const next = queue.then(work);
    queue = next.catch(() => {});
    return next;
  }
  async function publishSummary() {
    const id = chatId();
    const previous = state.summaryMessage;
    const message = await send(id, summary());
    state.summaryMessage = { chatId: id, id: message?.message_id };
    state.summaryPending = false;
    save();
    if (previous?.id && String(previous.chatId) === String(id) && bot.deleteMessage) {
      await bot.deleteMessage(id, previous.id).catch(() => {});
    }
  }

  async function tick(force = false) {
    if (busy || !chatId()) return;
    busy = true;
    try {
      const sites = await Promise.all(config.monitorTargets.map(async target => {
        const result = await probe(target.url, fetcher);
        return { key: target.key, label: target.label, ok: result.ok && result.ms < 5000,
          detail: `${result.detail}, ${result.ms} мс` };
      }));
      let metrics;
      try {
        const stat = fs.statSync(config.monitorMetricsPath);
        if (stat.size <= 262144) metrics = JSON.parse(fs.readFileSync(config.monitorMetricsPath, 'utf8'));
      } catch {}
      latest = [...sites, ...resourceChecks(metrics, now())];
      if (latest.find(c => c.key === 'host-data')?.ok) {
        hostDetails = [
          `VPS ${Math.floor(metrics.uptime / 3600)} ч · ${metrics.cpu?.cores ?? '—'} ядер`,
          `Сеть: ↓ ${((metrics.network?.rxBytesPerSecond || 0) / 1024).toFixed(1)} КБ/с, ↑ ${((metrics.network?.txBytesPerSecond || 0) / 1024).toFixed(1)} КБ/с`,
        ];
        if (Number.isFinite(state.hostUptime) && metrics.uptime + 60 < state.hostUptime) {
          if (await deliver('🔄 Обнаружена перезагрузка VPS. Проверки сайтов и ресурсов возобновлены.')) state.hostUptime = metrics.uptime;
        } else state.hostUptime = metrics.uptime;
      } else hostDetails = [];
      for (const c of latest) {
        const v = state.checks[c.key] ||= { failures: 0, successes: 0, alerted: false, lastAlert: 0 };
        v.failures = c.ok ? 0 : v.failures + 1;
        v.successes = c.ok ? v.successes + 1 : 0;
        // Confirm both failure and recovery; repeat a persistent incident hourly.
        if (!c.ok && v.failures >= (['cpu', 'ram', 'swap'].includes(c.key) ? 3 : 2) &&
            (!v.alerted || now() - v.lastAlert >= HOUR)) {
          if (await deliver(`🚨 ${c.label}: ${c.detail}\nПроблема подтверждена повторными проверками.`)) {
            v.alerted = true; v.lastAlert = now(); save();
          }
        } else if (c.ok && v.alerted && v.successes >= 2) {
          if (await deliver(`✅ Восстановление — ${c.label}: ${c.detail}`)) { v.alerted = false; save(); }
        }
      }
      const hourly = !state.lastSummary || now() - state.lastSummary >= HOUR;
      if (force || hourly || state.summaryPending || !state.summaryMessage) {
        await publishSummary();
        if (hourly) {
          state.lastSummary = now();
          for (const v of Object.values(state.errors)) v.count = 0;
        }
      }
      save();
    } finally { busy = false; }
  }

  // Categories are fixed by the caller. Never forward raw exceptions or tokens.
  async function recordError(category) {
    const v = state.errors[category] ||= { count: 0, lastAlert: 0 };
    v.count++; save();
    if (!v.lastAlert || now() - v.lastAlert >= 15 * 60000) {
      if (await deliver(`⚠️ Ошибка бота: ${category}.\nПовторы объединяются; подробности доступны в серверном журнале.`)) {
        v.lastAlert = now(); save();
        if (latest.length) await publishSummary();
      }
    }
  }

  async function onMessage(msg) {
    if (msg?.chat?.type !== 'private' || msg.chat.id !== msg.from?.id ||
        !/^\/(monitor|server)(?:@\w+)?\s*$/i.test(msg.text || '')) return;
    // Explicit numeric ID takes precedence. A first-time username claim is
    // pinned persistently; later username changes cannot redirect alerts.
    const authorized = chatId()
      ? String(msg.from.id) === String(chatId())
      : msg.from.username?.toLowerCase() === config.monitorUsername.toLowerCase();
    if (!authorized) return;
    if (!chatId()) { state.chatId = String(msg.from.id); save(); }
    try {
      await serialize(() => tick(true));
    } catch { console.error('[MONITOR] Status delivery failed'); }
  }
  function start() {
    bot.on('message', onMessage);
    const loop = async () => {
      try { await serialize(tick); } catch { console.error('[MONITOR] Check or delivery failed; will retry'); }
      setTimeout(loop, 60000).unref();
    };
    loop();
  }
  return {
    tick: () => serialize(tick),
    reportError: category => serialize(() => recordError(category)),
    afterBookmarks: id => String(id) === String(chatId()) ? serialize(async () => {
      if (latest.length) await publishSummary();
    }) : undefined,
    onMessage, start, summary,
  };
}
module.exports = { createMonitor, resourceChecks, probe };
