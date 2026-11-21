// Body tab (bodyweight + protein). Uses only the FAKE backup in tests/fake-test-data.json.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const BACKUP = path.join(__dirname, 'fake-test-data.json');
const TMPD = fs.mkdtempSync(path.join(os.tmpdir(), 'bodytest-'));
const results = [];
const ok = (name, cond, extra = '') => { results.push([cond ? 'PASS' : 'FAIL', name, extra]); if (!cond) console.log('FAILNOW', name, extra); };
const PORT = +process.env.PORT || (20000 + Math.floor(Math.random() * 20000)), URL_ = `http://localhost:${PORT}/`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const shift = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

(async () => {
  const srv = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', process.env.SITE || '.'], { stdio: 'ignore' });
  await sleep(800);
  const browser = await chromium.launch();
  const errs = [];
  const newCtx = () => browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const hook = p => { p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); };
  const store = p => p.evaluate(() => JSON.parse(localStorage.getItem('pplx2:data:v1') || '{}'));
  const settle = p => p.waitForFunction(() => document.getElementById('sync').textContent === 'All saved', null, { timeout: 15000 });
  const pick = p => p.click('#gymPick button[data-gym="minto"]');
  const txt = (p, sel) => p.textContent(sel);
  const body = p => p.click('#nav button[data-tab="body"]');
  const OLD = ['custom', 'progress', 'notes', 'sessions', 'meta'];

  const ctx = await newCtx(); const page = await ctx.newPage(); hook(page);
  await page.goto(URL_); await pick(page); await settle(page);

  // ---- restore the fake backup, which has no Body data (an "old" phone) ----
  await page.click('#nav button[data-tab="plan"]');
  await page.setInputFiles('#restoreFile', BACKUP); await page.waitForSelector('#restoreYes');
  ok('R: restore box mentions weigh-ins and protein days', /0 weigh-ins and 0 days of protein/.test(await txt(page, '#dataSection')));
  await Promise.all([page.waitForNavigation(), page.click('#restoreYes')]);
  await pick(page); await settle(page);
  const before = await store(page);
  ok('R: an old backup leaves no Body data and the app opens fine', Object.keys(before.body || {}).length === 0 && Object.keys(before.food || {}).length === 0 && Object.keys(before.goals || {}).length === 0 && Object.keys(before.sessions).length > 0);

  // ---- Body tab, empty ----
  await body(page);
  ok('B1: four tabs fit on the phone', (await page.$$eval('#nav button', b => b.length)) === 4 && await page.isVisible('#nav button[data-tab="body"]'));
  ok('B1: protein starts at 0 of the default 130 g', /^0\s*\/ 130 g$/.test((await txt(page, '#pTotal')).trim()), await txt(page, '#pTotal'));
  ok('B1: floor is 95 g by default', (await txt(page, '#pStatus')).includes('Floor 95 g'));
  ok('B1: no weigh-ins message', (await txt(page, '#wTrend')).includes('No weigh-ins yet'));

  // ---- protein ----
  const today = iso(new Date());
  await page.click('button[data-padd="30"]'); await page.click('button[data-padd="25"]');
  ok('P: quick adds add up', (await txt(page, '#pTotal')).trim().startsWith('55'), await txt(page, '#pTotal'));
  ok('P: says how far to the floor', /40 g.* to the floor/.test(await txt(page, '#pStatus')), await txt(page, '#pStatus'));
  await page.fill('#pCustom', '45'); await page.click('#pCustomAdd');
  ok('P: custom grams add', (await txt(page, '#pTotal')).trim().startsWith('100'));
  ok('P: floor passed message', (await txt(page, '#pStatus')).includes('Floor passed'));
  await page.click('button[data-padd="30"]');
  ok('P: target hit message', (await txt(page, '#pStatus')).includes('Target hit'));
  await page.click('#pUndo');
  ok('P: undo removes the last add', (await txt(page, '#pTotal')).trim().startsWith('100'));
  await page.fill('#pCustom', '0'); await page.click('#pCustomAdd');
  await page.fill('#pCustom', '999'); await page.click('#pCustomAdd');
  ok('P: 0 and 999 g are refused', (await txt(page, '#pTotal')).trim().startsWith('100'));
  await settle(page);
  let s = await store(page);
  ok('P: saved as one doc for today with each add', s.food && s.food[today] && JSON.stringify(s.food[today].entries) === '[30,25,45]' && s.food[today].total === 100, JSON.stringify(s.food));

  // ---- bodyweight: three weeks ----
  const now = new Date(); const mon = shift(now, -((now.getDay() + 6) % 7));
  const log = async (d, w) => { await page.fill('#bodyDate', iso(d)); await page.fill('#wIn', String(w)); await page.click('#wSave'); };
  await log(shift(mon, -14), 128); await log(shift(mon, -7), 129); await log(shift(mon, -6), 130); await log(mon, 131);
  await page.fill('#bodyDate', today);
  ok('W: latest weigh-in shown', (await txt(page, '#wLatest')).trim().startsWith('131'), await txt(page, '#wLatest'));
  const tr = await txt(page, '#wTrend');
  ok('W: weekly average and change shown (131, +1.5)', tr.includes('131 lb') && tr.includes('+1.5 lb against the week before'), tr);
  ok('W: weekly rate over 2 weeks is +1.5 lb a week', tr.includes('Over the last 2 weeks: +1.5 lb a week'), tr);
  ok('W: three weekly rows, middle week averages 129.5', (await page.$$eval('#wWeeks .row2', r => r.length)) === 3 && (await txt(page, '#wWeeks')).includes('129.5 lb'));
  ok('W: trend chart drawn', (await page.$$eval('svg.trend circle', c => c.length)) === 3);
  const nBefore = Object.keys((await store(page)).body).length;
  await page.fill('#wIn', '20'); await page.click('#wSave');
  ok('W: 20 lb is refused', Object.keys((await store(page)).body).length === nBefore && (await store(page)).body[today] === undefined || iso(mon) === today && Object.keys((await store(page)).body).length === nBefore);
  // update the same day
  await log(mon, 131.4);
  s = await store(page);
  ok('W: same-day weigh-in is replaced, not doubled', s.body[iso(mon)].weight === 131.4 && Object.keys(s.body).length === 4, JSON.stringify(Object.keys(s.body)));
  await page.click(`button[data-wdel="${iso(shift(mon, -6))}"]`);
  s = await store(page);
  ok('W: a weigh-in can be deleted', !s.body[iso(shift(mon, -6))] && Object.keys(s.body).length === 3);

  // ---- targets ----
  await page.fill('#tIn', '140'); await page.fill('#fIn', '100'); await page.click('#tSave');
  ok('T: target and floor can be changed', (await txt(page, '#pTotal')).includes('/ 140 g') && (await txt(page, '#pStatus')).includes('Floor 100 g'));
  await page.fill('#tIn', '140'); await page.fill('#fIn', '150'); await page.click('#tSave');
  ok('T: a floor above the target is refused', (await store(page)).goals.nutrition.floor === 100);
  await page.click('#nav button[data-tab="plan"]');
  ok('T: Plan shows the saved target', (await txt(page, '#plan')).includes('140 g target · 100 g floor'));

  // ---- nothing old changed ----
  await settle(page);
  s = await store(page);
  ok('S: workouts, notes, progress, exercises and meta are byte for byte unchanged', OLD.every(c => JSON.stringify(s[c]) === JSON.stringify(before[c])));

  // ---- reload keeps everything ----
  await page.reload(); await pick(page); await settle(page); await body(page);
  ok('K: after a reload the protein, weight and target are still there', (await txt(page, '#pTotal')).trim().startsWith('100') && (await txt(page, '#pTotal')).includes('/ 140 g') && (await txt(page, '#wLatest')).trim().startsWith('131.4'));

  // ---- phone width ----
  const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  ok('V: no sideways scroll at 390 px', w.sw <= w.cw, JSON.stringify(w));
  fs.mkdirSync(path.join(TMPD, 'shots'), { recursive: true });
  await page.screenshot({ path: path.join(TMPD, 'shots', 'body.png'), fullPage: true });

  // ---- backup carries it, a new phone gets it back ----
  await page.click('#nav button[data-tab="plan"]');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#backupBtn')]);
  const dlPath = path.join(TMPD, 'bk.json'); await dl.saveAs(dlPath);
  const bk = JSON.parse(fs.readFileSync(dlPath));
  ok('X: backup file holds the Body data', Object.keys(bk.data.body).length === 3 && bk.data.food[today].total === 100 && bk.data.goals.nutrition.protein === 140);
  const ctxB = await newCtx(); const pB = await ctxB.newPage(); hook(pB);
  await pB.goto(URL_); await pick(pB); await settle(pB);
  await pB.click('#nav button[data-tab="plan"]');
  await pB.setInputFiles('#restoreFile', dlPath); await pB.waitForSelector('#restoreYes');
  ok('X: restore box counts weigh-ins and protein days', /3 weigh-ins and 1 days of protein/.test(await txt(pB, '#dataSection')));
  await Promise.all([pB.waitForNavigation(), pB.click('#restoreYes')]);
  await pick(pB); await settle(pB);
  const sB = await store(pB);
  ok('X: a restored phone has identical Body data', ['body', 'food', 'goals'].every(c => JSON.stringify(sB[c]) === JSON.stringify(s[c])));
  await body(pB);
  ok('X: and shows it', (await txt(pB, '#pTotal')).trim().startsWith('100'));
  // restoring an OLD backup replaces everything but keeps a safety copy that still holds the Body data
  await pB.click('#nav button[data-tab="plan"]');
  await pB.setInputFiles('#restoreFile', BACKUP); await pB.waitForSelector('#restoreYes');
  await Promise.all([pB.waitForNavigation(), pB.click('#restoreYes')]);
  const safety = await pB.evaluate(() => JSON.parse(localStorage.getItem('pplx2:before-restore') || '{}'));
  ok('X: restoring an old file keeps a safety copy with the Body data', safety.food && safety.food[today] && Object.keys(safety.body).length === 3);
  await ctxB.close();

  const real2 = errs.filter(e => !/ERR_TUNNEL|fonts\.g|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(e));
  ok('no page errors', real2.length === 0, real2.join(' | '));
  await browser.close(); try { srv.kill(); } catch (e) {}
  console.log('screenshot: ' + path.join(TMPD, 'shots', 'body.png'));
  console.log(results.map(r => r.join('  ')).join('\n'));
  console.log(results.filter(r => r[0] === 'FAIL').length + ' failed of ' + results.length);
})();
