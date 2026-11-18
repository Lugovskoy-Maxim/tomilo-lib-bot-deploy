const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createMonitor, resourceChecks, probe } = require('./server-monitor');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tomilo-monitor-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let time = Date.parse('2026-11-18T22:00:00Z');
  let status = 200;
  const calls = [];
  const config = { monitorChatId: '123', monitorUsername: 'tomilodev',
    monitorStatePath: path.join(dir, 'state.json'), monitorMetricsPath: path.join(dir, 'metrics.json'),
    monitorTargets: [{ key: 'lib', label: 'Lib', url: 'https://example.com/' }] };
  const deps = { config, bot: {}, now: () => time,
    fetcher: async () => ({ ok: status === 200, status }), send: async (id, text) => calls.push({ id, text }) };
  return { config, calls, deps, monitor: createMonitor(deps),
    status: n => { status = n; }, advance: n => { time += n; } };
}

test('summary is hourly and schedule survives restart', async t => {
  const f = fixture(t);
  await f.monitor.tick();
  assert.equal(f.calls.filter(c => c.text.startsWith('📊')).length, 1);
  f.advance(3599000); await createMonitor(f.deps).tick();
  assert.equal(f.calls.filter(c => c.text.startsWith('📊')).length, 1);
  f.advance(1000); await f.monitor.tick();
  assert.equal(f.calls.filter(c => c.text.startsWith('📊')).length, 2);
});

test('confirmed outage and recovery are deduplicated independently of summary', async t => {
  const f = fixture(t);
  await f.monitor.tick(); f.calls.length = 0;
  f.status(503); await f.monitor.tick();
  assert.equal(f.calls.filter(c => c.text.startsWith('🚨 Lib')).length, 0);
  await f.monitor.tick(); await f.monitor.tick();
  assert.equal(f.calls.filter(c => c.text.startsWith('🚨 Lib')).length, 1);
  f.status(200); await f.monitor.tick(); await f.monitor.tick(); await f.monitor.tick();
  assert.equal(f.calls.filter(c => c.text.startsWith('✅ Восстановление — Lib')).length, 1);
});

test('failed Telegram send is retried and never marked as delivered', async t => {
  const f = fixture(t);
  let fail = true;
  f.deps.send = async (id, text) => { if (fail) throw Error('Telegram unavailable'); f.calls.push({ id, text }); };
  const monitor = createMonitor(f.deps);
  await assert.rejects(monitor.tick(), /Telegram/);
  fail = false; await monitor.tick();
  assert.equal(f.calls.filter(c => c.text.startsWith('📊')).length, 1);
});

test('private status command only responds to configured numeric recipient', async t => {
  const f = fixture(t);
  await f.monitor.onMessage({ chat: { type: 'private', id: 999 }, from: { id: 999, username: 'tomilodev' }, text: '/server' });
  assert.equal(f.calls.length, 0);
  await f.monitor.onMessage({ chat: { type: 'private', id: 123 }, from: { id: 123 }, text: '/server' });
  assert.ok(f.calls.length > 0);
  assert.ok(f.calls.every(c => c.id === '123'));
});

test('raw request exceptions are never forwarded and pipeline errors are grouped', async t => {
  const f = fixture(t);
  const result = await probe('https://example.com', async () => { throw Error('secret-token'); });
  assert.equal(result.ok, false); assert.doesNotMatch(result.detail, /secret/);
  await f.monitor.reportError('Рассылка новых глав'); await f.monitor.reportError('Рассылка новых глав');
  assert.equal(f.calls.length, 1);
  f.advance(900000); await f.monitor.reportError('Рассылка новых глав');
  assert.equal(f.calls.length, 2);
});

test('stale host data is distinct from measured pressure; container memory is never used', () => {
  const now = Date.now();
  assert.equal(resourceChecks({ sampledAt: new Date(now - 100000).toISOString() }, now)[0].ok, false);
  const checks = resourceChecks({ sampledAt: new Date(now).toISOString(), cpu: { usage: 95 },
    memory: { percentage: 91 }, disk: { percentage: 50, available: 1024 }, swap: { percentage: 0 } }, now);
  assert.equal(checks.find(c => c.key === 'cpu').ok, false);
  assert.equal(checks.find(c => c.key === 'ram').ok, false);
  assert.equal(checks.find(c => c.key === 'disk').ok, false);
  assert.equal(checks.find(c => c.key === 'swap').ok, true);
});
