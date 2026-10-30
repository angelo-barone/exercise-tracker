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
// base is the frozen version 1 starting program. current is the real program.json being released.
const base = JSON.parse(fs.readFileSync(path.join(__dirname, 'program-v1.json')));
const current = JSON.parse(fs.readFileSync(path.join(SITE, 'program.json')));
const setProg = o => fs.writeFileSync(path.join(TMP, 'program.json'), JSON.stringify(o));
const clone = o => JSON.parse(JSON.stringify(o));
const results = [];
const ok = (n, c, x = '') => { results.push([c ? 'PASS' : 'FAIL', n, x]); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = +process.env.PORT || (20000 + Math.floor(Math.random() * 20000)), URL_ = `http://localhost:${PORT}/`;

// On Windows python3 is a launcher, so stopping it must also stop the server it started
let srv;
const killSrv = () => { try { if (srv) { if (process.platform === 'win32') require('child_process').execSync('taskkill /pid ' + srv.pid + ' /T /F', { stdio: 'ignore' }); else srv.kill(); } } catch (e) {} };

(async () => {
  srv = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', TMP], { stdio: 'ignore' });
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

  // S8 the real program.json on a fresh phone: Full Body list and the warm-up change
  setProg(base);
  const ctx2 = await browser.newContext({ viewport: { width: 400, height: 850 } });
  const p2 = await ctx2.newPage(); p2.on('pageerror', e => errs.push(e.message));
  const d8 = new Date(), today = d8.getFullYear() + '-' + String(d8.getMonth() + 1).padStart(2, '0') + '-' + String(d8.getDate()).padStart(2, '0');
  await p2.goto(URL_); await pick(p2, 'minto'); await p2.waitForTimeout(500);
  await p2.click('#nav button[data-tab="plan"]');
  await p2.setInputFiles('#restoreFile', BACKUP); await p2.waitForSelector('#restoreYes');
  await Promise.all([p2.waitForNavigation(), p2.click('#restoreYes')]);
  await pick(p2, 'minto'); await p2.waitForTimeout(1000);
  const before8 = await store(p2);
  await p2.click('#daySeg button[data-day="fullbody"]');
  ok('S8: before the update Full Body is empty, with no Add button', (await names(p2)).length === 0 && !(await p2.$('.addbtn')) && (await p2.textContent('#exlist')).includes('program file'));

  const badFb = clone(current); badFb.version = 9; badFb.fullBody = current.fullBody.concat(['zz_nope']); setProg(badFb);
  await p2.reload(); await pick(p2, 'minto'); await p2.waitForTimeout(1000);
  await p2.click('#nav button[data-tab="plan"]');
  ok('S8: Full Body list naming an unknown exercise is refused', !(await p2.isVisible('#programBanner')) && (await p2.textContent('#programSection')).includes('problem'));

  setProg(current);
  await p2.reload(); await pick(p2, 'minto'); await p2.waitForTimeout(1200);
  ok('S8: banner shows the real version', (await p2.isVisible('#programBanner')) && (await p2.textContent('#programBanner')).includes('version ' + current.version));
  await p2.click('#programBanner'); await p2.waitForSelector('#programYes');
  const sec8 = await p2.textContent('#programSection');
  const exName = id => current.exercises.find(e => e.id === id).name;
  ok('S8: lists the three warm-up changes', ['p_incline', 'pl_pulldown', 'lg_press'].every(id => sec8.includes(exName(id) + ': warm-up sets 2 to 1')), sec8.slice(0, 600));
  ok('S8: lists the Full Body list in order', current.fullBody.every((id, i) => sec8.includes((i + 1) + '. ' + exName(id))), sec8.slice(0, 900));
  ok('S8: nothing else is listed', !sec8.includes('New exercises') && !sec8.includes('Removed') && !sec8.includes('New order on') && (sec8.match(/warm-up sets/g) || []).length === 3, sec8);
  ok('S8: nothing changed before tapping Apply', (await store(p2)).custom.p_incline.warmup === 2);
  await p2.click('#programYes'); await settle(p2);
  const after8 = await store(p2);
  ok('S8: warm-up is 1 on the three exercises', ['p_incline', 'pl_pulldown', 'lg_press'].every(id => after8.custom[id].warmup === 1));
  ok('S8: Full Body places stored in order, on exactly 11 exercises', current.fullBody.every((id, i) => after8.custom[id].fb === (i + 1) * 10) && Object.keys(after8.custom).filter(id => after8.custom[id].fb != null).length === 11);
  ok('S8: exercises keep their own day and no copies were made', after8.custom.lg_press.day === 'legs' && after8.custom.p_incline.day === 'push' && Object.keys(after8.custom).length === Object.keys(before8.custom).length);
  ok('S8: sessions, notes and progress untouched', JSON.stringify(after8.sessions) === JSON.stringify(before8.sessions) && JSON.stringify(after8.notes) === JSON.stringify(before8.notes) && JSON.stringify(after8.progress) === JSON.stringify(before8.progress));

  await p2.click('#nav button[data-tab="today"]');
  await p2.click('#daySeg button[data-day="fullbody"]');
  ok('S8: Full Body tab shows the 11 exercises in the asked order', JSON.stringify(await names(p2)) === JSON.stringify(current.fullBody.map(exName)), (await names(p2)).join(' | '));
  await p2.click('.exhead >> nth=0');
  const open8 = await p2.textContent('.ex.open');
  ok('S8: Full Body hides Delete, Move and Add but keeps Edit', !open8.includes('Delete exercise') && !open8.includes('Move up') && !open8.includes('Move down') && !(await p2.$('.addbtn')) && open8.includes('Edit name, gym, sets'));
  await p2.click('#daySeg button[data-day="push"]');
  await p2.click('.exhead:has(.exname:text-is("Incline Bench Press"))');
  const openPush = await p2.textContent('.ex.open');
  ok('S8: Push still has Delete, Move and Add', openPush.includes('Delete exercise') && openPush.includes('Move down') && !!(await p2.$('.addbtn')));
  ok('S8: Push order untouched', (await names(p2)).slice(0, 3).join('|') === 'Incline Bench Press|Seated Shoulder Press|Chest Press Machine');

  await p2.click('#daySeg button[data-day="fullbody"]');
  await p2.click('.exhead:has(.exname:text-is("Lat Pulldown"))');
  ok('S8: Lat Pulldown now has 1 warm-up row', (await p2.textContent('.ex.open')).includes('Warm 1') && !(await p2.textContent('.ex.open')).includes('Warm 2'));
  for (let k = 0; k < 2; k++) {
    await p2.fill('.ex.open .setrow.active input[aria-label="Repetitions"]', '10');
    await p2.click('.ex.open .setrow.active .logbtn'); await p2.click('#restSkip'); await settle(p2);
  }
  const s8 = await store(p2);
  const todays = Object.keys(s8.sessions).filter(k => k.startsWith(today));
  ok('S8: a Full Body workout is its own session, not Pull', todays.join() === today + '_fullbody' && s8.sessions[today + '_fullbody'].day === 'fullbody' && s8.sessions[today + '_fullbody'].gym === 'minto');
  ok('S8: it logged against the same Lat Pulldown id', !!s8.sessions[today + '_fullbody'].log.pl_pulldown && s8.progress.pl_pulldown.date === today);
  await p2.click('#daySeg button[data-day="pull"]');
  ok('S8: Pull day shows that same history for Lat Pulldown', (await p2.textContent('.exhead:has(.exname:text-is("Lat Pulldown")) .exlast')).includes('10 reps'));
  await p2.click('#nav button[data-tab="history"]'); await p2.waitForTimeout(500);
  ok('S8: History shows Full Body', (await p2.textContent('#history')).includes('Full Body'));
  await p2.click('#nav button[data-tab="plan"]');
  const plan8 = await p2.textContent('#plan');
  ok('S8: Plan lists Full Body and the week is unchanged', plan8.includes('Full Body') && plan8.includes('Ab Crunch Machine') && (await p2.evaluate(() => WEEK.join())) === 'push,pull,legs,rest,push,pull,legs');
  await p2.reload(); await pick(p2, 'minto'); await p2.waitForTimeout(1000);
  ok('S8: no banner again after reload', !(await p2.isVisible('#programBanner')));
  await p2.click('#daySeg button[data-day="fullbody"]');
  ok('S8: Full Body list survives a reload', (await names(p2)).length === 11);
  await ctx2.close();

  const real = errs.filter(e => !/ERR_|fonts|Failed to load/.test(e));
  ok('no page errors', real.length === 0, real.join(' | '));
  await browser.close(); killSrv();
  console.log(results.map(r => r.join('  ')).join('\n'));
  console.log(results.filter(r => r[0] === 'FAIL').length + ' failed of ' + results.length);
})().catch(e => { killSrv(); console.log(results.map(r => r.join('  ')).join('\n')); console.error(e.message); process.exit(1); });
