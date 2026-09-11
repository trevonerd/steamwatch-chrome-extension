const { chromium } = require(process.env.SW_PLAYWRIGHT_PATH || 'playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const output = path.resolve(process.env.SW_QA_OUTPUT || '.sisyphus/evidence/final');
const chrome = process.env.SW_CHROME_PATH;
fs.mkdirSync(output, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'steamwatch-restart-'));
const wait = (promise, step) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`Timed out: ${step}`)), 10_000))]);
(async () => {
  const context = await chromium.launchPersistentContext(profile, { executablePath: chrome, headless: false, args: [`--disable-extensions-except=${path.resolve('dist')}`, `--load-extension=${path.resolve('dist')}`] });
  try {
    let mode = 'offline';
    await context.route(/https:\/\/(api\.steampowered\.com|steamcharts\.com|steamspy\.com|games-popularity\.com|gql\.twitch\.tv)\//, async (route) => {
      const url = new URL(route.request().url());
      if (mode === 'offline') return route.abort();
      if (url.hostname === 'api.steampowered.com') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ response: { player_count: 43 } }) });
      return route.fulfill({ status: 404, body: '' });
    });
    console.log('milestone: context ready');
    const worker = context.serviceWorkers()[0] ?? await wait(context.waitForEvent('serviceworker'), 'initial worker');
    const extensionId = new URL(worker.url()).host;
    await worker.evaluate(async () => {
      await chrome.alarms.clearAll();
      await chrome.storage.local.set({ sw_games: [{ appid: '1', name: 'Restart Game', image: '' }], sw_cache: { '1': { current: 42, fetchedAt: Date.now() } }, sw_settings: { notificationsEnabled: false, badgeFavoriteAppid: '1' }, sw_migration_complete: true });
    });
    console.log('milestone: seeded');
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('ServiceWorker.enable');
    const versions = [];
    cdp.on('ServiceWorker.workerVersionUpdated', (event) => versions.push(...event.versions));
    const initial = versions.find((version) => version.registrationId) ?? await wait(new Promise((resolve) => cdp.once('ServiceWorker.workerVersionUpdated', (event) => resolve(event.versions[0]))), 'initial version');
    const initialScriptUrl = initial.scriptURL;
    await cdp.send('ServiceWorker.stopWorker', { versionId: initial.versionId });
    console.log('milestone: stopped');
    const restartVersionPromise = new Promise((resolve) => {
      cdp.on('ServiceWorker.workerVersionUpdated', (event) => {
        const running = event.versions.find((version) => version.registrationId === initial.registrationId && version.runningStatus === 'running');
        if (running) resolve(running);
      });
    });
    await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
    // A runtime message is the browser-supported way to wake an MV3 worker.
    // PING is intentionally unhandled; delivery itself starts the worker.
    await wait(page.evaluate(async () => {
      try { await chrome.runtime.sendMessage({ type: 'PING' }); } catch (error) { console.info(`Expected PING response error: ${String(error)}`); }
    }), 'wake message');
    const restartedVersion = await wait(restartVersionPromise, 'restarted worker version');
    const restarted = context.serviceWorkers().find((candidate) => candidate.url() === restartedVersion.scriptURL);
    assert(restarted, 'Playwright did not expose the restarted extension worker');
    assert.equal(restarted.url(), worker.url());
    console.log('milestone: restarted');
    const offline = await page.evaluate(async () => ({ response: await chrome.runtime.sendMessage({ type: 'FETCH_NOW' }), cache: await chrome.storage.local.get('sw_cache') }));
    assert.equal(offline.response.ok, false);
    assert.equal(offline.cache.sw_cache['1'].current, 42);
    assert.equal(offline.cache.sw_cache['1'].freshness.current.status, 'error');
    console.log('milestone: offline asserted');
    mode = 'recovery';
    const recovered = await page.evaluate(async () => ({ response: await chrome.runtime.sendMessage({ type: 'FETCH_NOW' }), cache: await chrome.storage.local.get('sw_cache') }));
    assert.equal(recovered.response.ok, true);
    assert.equal(recovered.cache.sw_cache['1'].current, 43);
    console.log('milestone: recovery asserted');
    const snapshots = await restarted.evaluate(async () => {
      const db = await new Promise((resolve, reject) => { const request = indexedDB.open('steamwatch'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      try { return await new Promise((resolve, reject) => { const request = db.transaction('snapshots').objectStore('snapshots').getAll(); request.onsuccess = () => resolve(request.result.map((item) => item.current)); request.onerror = () => reject(request.error); }); } finally { db.close(); }
    });
    assert(snapshots.includes(43));
    const native = await restarted.evaluate(async () => {
      const permission = await chrome.notifications.getPermissionLevel();
      if (permission !== 'granted') return { permission, status: 'blocked' };
      globalThis.nativeDeliveries = [];
      const create = chrome.notifications.create.bind(chrome.notifications);
      chrome.notifications.create = async (id, options) => {
        const result = await create(id, options);
        globalThis.nativeDeliveries.push({ id: result, title: options.title });
        return result;
      };
      const now = Date.now();
      await chrome.storage.local.set({
        sw_settings: { notificationsEnabled: true, quietHoursEnabled: false, badgeFavoriteAppid: '1' },
        sw_gs_1: { notifyThresholdPlayers: 40 },
        sw_notification_state_1: { above: { fingerprint: 'above:40', lastValue: 43,
          lastObservedAt: now - 300000, crossedAt: now - 300000, armed: true, observations: 1 } }
      });
      return { permission, status: 'seeded' };
    });
    if (native.status === 'seeded') {
      await page.evaluate(() => chrome.runtime.sendMessage({ type: 'FETCH_NOW' }));
      await page.evaluate(() => chrome.runtime.sendMessage({ type: 'FETCH_NOW' }));
      const delivery = await restarted.evaluate(async () => ({ attempts: globalThis.nativeDeliveries,
        state: (await chrome.storage.local.get('sw_notification_state_1')).sw_notification_state_1,
        active: await chrome.notifications.getAll(), badge: await chrome.action.getBadgeText({}) }));
      assert.equal(delivery.attempts.length, 1);
      assert.equal(delivery.state.above.armed, false);
      assert.equal(delivery.state.above.pendingId, undefined);
      assert.equal(delivery.badge, '43');
      for (const entry of delivery.attempts) await restarted.evaluate((id) => chrome.notifications.clear(id), entry.id);
      Object.assign(native, { status: 'accepted-by-chrome', ...delivery });
    }
    fs.writeFileSync(path.join(output, 'qa-restart.json'), JSON.stringify({ extensionId, initialScriptUrl, restartScriptUrl: restarted.url(), workerVersions: versions.length, offline, recovered, snapshots, native }, null, 2));
    console.log(`PASS worker restart, offline cache preservation, recovered snapshot; native notification: ${native.status}`);
  } finally { await context.close(); fs.rmSync(profile, { recursive: true, force: true }); }
})().catch((error) => { console.error(`${error instanceof Error ? error.stack : String(error)}`); process.exitCode = 1; });
