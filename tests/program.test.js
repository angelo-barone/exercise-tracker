// Tests the program.json update flow. Run from the repo root:
// SITE=. NODE_PATH=$(npm root -g) node tests/program.test.js
// It uses tests/fake-test-data.json (made-up data). Set TRACKER_BACKUP only to try a different file.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const BACKUP = path.resolve(process.env.TRACKER_BACKUP || path.join(__dirname, 'fake-test-data.json'));
const SITE = path.resolve(process.env.SITE || '.');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'progsite-'));
fs.cpSync(SITE, TMP, { recursive: true, filter: s => !/[\\/](\.git|tests|private)([\\/]|$)/.test(s) });
const base = JSON.parse(fs.readFileSync(path.join(SITE, 'program.json')));
const setProg = o => fs.writeFileSync(path.join(TMP, 'program.json'), JSON.stringify(o));
const clone = o => JSON.parse(JSON.stringify(o));
const results = [];
const ok = (n, c, x = '') => { results.push([c ? 'PASS' : 'FAIL', n, x]); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 8771, URL_ = `http://localhost:${PORT}/`;

(async () => {
  const srv = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', TMP], { stdio: 'ignore' });
  await sleep(800);
  const browser = await chromium.launch();
  const errs = [];
  const store = p => p.evaluate(() => JSON.parse(localStorage.getItem('pplx2:data:v1') || '{}'));
  const names = p => p.$$eval('.exlist .exname', els => els.map(e => e.textContent));
  const settle = p => p.waitForFunction(() => document.getElementById('sync').textContent === 'All saved', null, { timeout: 15000 });
  const pick = async (p, g) => { await p.click(`#gymPick button[data-gym="${g}"]`); };
  const open = async ctx => { const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message)); await p.goto(URL_); await pick(p, 'minto'); await p.waitForTimeout(700); return p; };
  const realData = JSON.parse(fs.readFileSync(BACKUP)).data;

  // phone with his real data restored
  setProg(base);
  const ctx = await browser.newContext({ viewport: { width: 400, height: 850 } });
  let page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
  await page.goto(URL_); await pick(page, 'minto'); await page.waitForTimeout(500);
  await page.click('#nav button[data-tab="plan"]');
  await page.setInputFiles('#restoreFile', BACKUP); await page.waitForSelector('#restoreYes');
  await Promise.all([page.waitForNavigation(), page.click('#restoreYes')]);
  await pick(page, 'minto'); await page.waitForTimeout(1000);
  ok('S1: file identical to phone, no banner', !(await page.isVisible('#programBanner')));
  ok('S1: version 1 marked applied silently', await page.evaluate(() => localStorage.getItem('pplx2:programApplied')) === '1');
  const before = await store(page);

  // a phone-only exercise, added in the app
  await page.click('#nav button[data-tab="today"]');
  await page.click('#daySeg button[data-day="push"]');
  await page.click('.addbtn'); await page.fill('#cname', 'My Own Move'); await page.click('.cform >> text=Add exercise'); await settle(page);

  // S2 a real update: rename, add in the middle, remove, reorder
  const v2 = clone(base); v2.version = 2; v2.note = 'Test update';
  v2.exercises.find(e => e.id === 'p_shoulder').name = 'Shoulder Press (Machine)';
  const pushIdx = v2.exercises.findIndex(e => e.id === 'p_chestpress');
  v2.exercises.splice(pushIdx + 1, 0, { id: 'x_kneel', name: 'Kneeling Cable Crunch', day: 'push', sets: 3, lo: 10, hi: 15, load: 'upper', gym: 'montpetit' });
  v2.exercises = v2.exercises.filter(e => e.id !== 'c_mu0gm1ql');
  v2.removed = ['c_mu0gm1ql', 'c_not_there'];
  const curl = v2.exercises.findIndex(e => e.id === 'pl_curl'); const [cv] = v2.exercises.splice(curl, 1);
  const firstPull = v2.exercises.findIndex(e => e.day === 'pull'); v2.exercises.splice(firstPull, 0, cv);
  setProg(v2);
  await page.reload(); await pick(page, 'minto'); await page.waitForTimeout(1200);
  ok('S2: banner shows with version', (await page.isVisible('#programBanner')) && (await page.textContent('#programBanner')).includes('version 2'));
  ok('S2: nothing changed before tapping Apply', !(await names(page)).includes('Kneeling Cable Crunch'));
  await page.click('#programBanner');
  await page.waitForSelector('#programYes');
  const sec = await page.textContent('#programSection');
  ok('S2: lists added, changed, removed, order and kept', sec.includes('Kneeling Cable Crunch') && sec.includes('Seated Shoulder Press') && sec.includes('Shoulder Press (Machine)') && sec.includes('Declined Dumbbell Crunch') && sec.includes('New order on') && sec.includes('Pull') && sec.includes('My Own Move') && sec.includes('Test update'), sec.slice(0, 400));
  ok('S2: unknown removed id ignored quietly', !sec.includes('c_not_there'));
  await page.click('#programYes'); await settle(page);
  const after = await store(page);
  ok('S2: renamed', after.custom.p_shoulder.name === 'Shoulder Press (Machine)');
  ok('S2: added with its gym tag', after.custom.x_kneel && after.custom.x_kneel.gym === 'montpetit' && after.custom.x_kneel.sets === 3);
  ok('S2: removed', !after.custom.c_mu0gm1ql);
  ok('S2: sessions, notes and progress untouched', JSON.stringify(after.sessions) === JSON.stringify(before.sessions) && JSON.stringify(after.notes) === JSON.stringify(before.notes) && JSON.stringify(after.progress) === JSON.stringify(before.progress));
  ok('S2: safety copy stored', await page.evaluate(() => !!localStorage.getItem('pplx2:before-program')));
  const pushOrder = Object.keys(after.custom).filter(id => after.custom[id].day === 'push').sort((a, b) => after.custom[a].order - after.custom[b].order).map(id => after.custom[id].name);
  ok('S2: new exercise sits right after Chest Press Machine', pushOrder[pushOrder.indexOf('Chest Press Machine') + 1] === 'Kneeling Cable Crunch', pushOrder.join(' | '));
  ok('S2: phone-only exercise kept and placed last', pushOrder[pushOrder.length - 1] === 'My Own Move' && pushOrder.length === 14, pushOrder.length + ' ' + pushOrder.join(' | '));
  const pullOrder = Object.keys(after.custom).filter(id => after.custom[id].day === 'pull').sort((a, b) => after.custom[a].order - after.custom[b].order);
  ok('S2: Pull reordered, Cable Bicep Curl first', pullOrder[0] === 'pl_curl');
  ok('S2: applied version recorded', await page.evaluate(() => localStorage.getItem('pplx2:programApplied')) === '2');
  await page.reload(); await pick(page, 'minto'); await page.waitForTimeout(1000);
  ok('S2: no banner again after reload', !(await page.isVisible('#programBanner')));
  await page.click('#daySeg button[data-day="push"]');
  ok('S2: Today list is Minto filtered (Montpetit only exercise hidden)', !(await names(page)).includes('Kneeling Cable Crunch'));
  await page.click('#nav button[data-tab="history"]'); await page.waitForTimeout(400);
  ok('S2: history still shows old workouts', (await page.textContent('#history')).includes('2026-10-14'));

  // S3 not now
  const v3 = clone(v2); v3.version = 3; v3.exercises.find(e => e.id === 'pl_row').sets = 3; setProg(v3);
  await page.click('#nav button[data-tab="today"]');
  await page.reload(); await pick(page, 'minto'); await page.waitForTimeout(1200);
  ok('S3: new version seen without any cache (sw does not cache it)', (await page.textContent('#programBanner')).includes('version 3'));
  await page.click('#programBanner'); await page.waitForSelector('#programNo');
  ok('S3: change shown for sets edit', (await page.textContent('#programSection')).includes('Seated Cable Row'));
  await page.click('#programNo');
  ok('S3: Not now hides the section', !(await page.$('#programSection')));
  await page.click('#nav button[data-tab="today"]');
  ok('S3: Not now hides the banner', !(await page.isVisible('#programBanner')));
  await page.reload(); await pick(page, 'minto'); await page.waitForTimeout(1000);
  ok('S3: banner returns on next open', await page.isVisible('#programBanner'));
  ok('S3: data unchanged while undecided', (await store(page)).custom.pl_row.sets === 2);

  // S3b file that contradicts itself
  const contra = clone(v3); contra.version = 9; contra.removed = ['pl_row']; setProg(contra);
  await page.reload(); await pick(page, 'minto'); await page.waitForTimeout(1000);
  ok('S3b: id both listed and removed is rejected', !(await page.isVisible('#programBanner')));
  setProg(v3);
  await page.reload(); await pick(page, 'minto'); await page.waitForTimeout(1000);

  // S4 broken file
  const bad = clone(v3); bad.version = 4; bad.exercises[2].day = 'monday'; setProg(bad);
  await page.reload(); await pick(page, 'minto'); await page.waitForTimeout(1000);
  ok('S4: broken file shows no banner', !(await page.isVisible('#programBanner')));
  await page.click('#nav button[data-tab="plan"]');
  ok('S4: Plan explains the problem, nothing changed', (await page.textContent('#programSection')).includes('problem') && (await store(page)).custom.pl_row.sets === 2);
  fs.writeFileSync(path.join(TMP, 'program.json'), '{ not json');
  await page.reload(); await pick(page, 'minto'); await page.waitForTimeout(800);
  ok('S4: unreadable file ignored', !(await page.isVisible('#programBanner')));

  // S5 old or equal version
  const old = clone(v3); old.version = 2; old.exercises.find(e => e.id === 'pl_row').sets = 5; setProg(old);
  await page.reload(); await pick(page, 'minto'); await page.waitForTimeout(800);
  ok('S5: older version ignored', !(await page.isVisible('#programBanner')));

  // S6 no file at all, and offline
  fs.unlinkSync(path.join(TMP, 'program.json'));
  await page.reload(); await pick(page, 'minto'); await page.waitForTimeout(800);
  ok('S6: missing file is silent', !(await page.isVisible('#programBanner')));
  setProg(v3);
  await ctx.setOffline(true);
  await page.reload(); await pick(page, 'minto'); await page.waitForTimeout(800);
  ok('S6: offline is silent and app still opens', !(await page.isVisible('#programBanner')) && (await names(page)).length > 0);
  await ctx.setOffline(false);

  // S7 apply v3 then restore a backup from before: program applied marker handling
  await page.reload(); await pick(page, 'minto'); await page.waitForTimeout(1000);
  await page.click('#programBanner'); await page.waitForSelector('#programYes'); await page.click('#programYes'); await settle(page);
  ok('S7: sets edit applied', (await store(page)).custom.pl_row.sets === 3);

  const real = errs.filter(e => !/ERR_|fonts|Failed to load/.test(e));
  ok('no page errors', real.length === 0, real.join(' | '));
  await browser.close(); srv.kill();
  console.log(results.map(r => r.join('  ')).join('\n'));
  console.log(results.filter(r => r[0] === 'FAIL').length + ' failed of ' + results.length);
})();
