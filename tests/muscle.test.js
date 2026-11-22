// Muscle headings (app 2.8.0, program version 6). Run from the repo root:
// SITE=. NODE_PATH=$(npm root -g) node tests/muscle.test.js
// Uses only tests/fake-test-data.json (made-up data) and the frozen files program-v1.json and program-v6.json.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const BACKUP = path.resolve(process.env.TRACKER_BACKUP || path.join(__dirname, 'fake-test-data.json'));
const SITE = path.resolve(process.env.SITE || '.');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'musclesite-'));
fs.cpSync(SITE, TMP, { recursive: true, filter: s => !/[\\/](\.git|tests|private)([\\/]|$)/.test(s) });
const rd = f => JSON.parse(fs.readFileSync(path.join(__dirname, f)));
const v1 = rd('program-v1.json'), v6 = rd('program-v6.json');
const setProg = o => fs.writeFileSync(path.join(TMP, 'program.json'), JSON.stringify(o));
const clone = o => JSON.parse(JSON.stringify(o));
const results = [];
const ok = (n, c, x = '') => { results.push([c ? 'PASS' : 'FAIL', n, x]); if (!c) console.log('FAILNOW', n, x); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = +process.env.PORT || (20000 + Math.floor(Math.random() * 20000)), URL_ = `http://localhost:${PORT}/`;
let srv;
const killSrv = () => { try { if (srv) srv.kill(); } catch (e) {} };

(async () => {
  srv = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', TMP], { stdio: 'ignore' });
  await sleep(800);
  const browser = await chromium.launch();
  const errs = [];
  const store = p => p.evaluate(() => JSON.parse(localStorage.getItem('pplx2:data:v1') || '{}'));
  const settle = p => p.waitForFunction(() => document.getElementById('sync').textContent === 'All saved', null, { timeout: 15000 });
  const pick = (p, g) => p.click(`#gymPick button[data-gym="${g}"]`);
  const reload = async (p, g = 'minto') => { await p.reload(); await pick(p, g); await p.waitForTimeout(1000); };
  const day = async (p, d) => { await p.click('#nav button[data-tab="today"]'); await p.click(`#daySeg button[data-day="${d}"]`); };
  const heads = p => p.$$eval('.exlist .grouphead', els => els.map(e => e.textContent));
  const names = p => p.$$eval('.exlist .exname', els => els.map(e => e.textContent));
  // headings and exercise names in screen order, e.g. ["#Chest","Incline Bench Press",...]
  const flow = p => p.$$eval('.exlist > *', els => els.map(e => e.classList.contains('grouphead') ? '#' + e.textContent : (e.querySelector('.exname') || {}).textContent));

  setProg(v1);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 850 } });
  const page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
  await page.goto(URL_); await pick(page, 'minto'); await page.waitForTimeout(500);
  await page.click('#nav button[data-tab="plan"]');
  await page.setInputFiles('#restoreFile', BACKUP); await page.waitForSelector('#restoreYes');
  await Promise.all([page.waitForNavigation(), page.click('#restoreYes')]);
  await pick(page, 'minto'); await page.waitForTimeout(1000);

  // ---- before: no muscle names, so no headings ----
  await day(page, 'push');
  ok('M0: no headings on a phone without muscle names', (await heads(page)).length === 0);
  const before = await store(page);
  const keep = s => JSON.stringify({ s: s.sessions, n: s.notes, p: s.progress });

  // ---- a file with a bad muscle name is refused whole ----
  const bad = clone(v6); bad.exercises[0].muscle = '   ';
  setProg(bad); await reload(page);
  await page.click('#nav button[data-tab="plan"]');
  const t0 = await page.textContent('#plan');
  ok('M1: a blank muscle name is refused whole', !(await page.isVisible('#programBanner')) && t0.includes('invalid muscle name'));
  const bad2 = clone(v6); bad2.exercises[0].muscle = 'x'.repeat(40);
  setProg(bad2); await reload(page);
  await page.click('#nav button[data-tab="plan"]');
  ok('M1: a 40 letter muscle name is refused whole', (await page.textContent('#plan')).includes('invalid muscle name'));

  // ---- the real file is offered and lists the muscle changes ----
  setProg(v6); await reload(page);
  ok('M2: the update banner shows', await page.isVisible('#programBanner'));
  await page.click('#programBanner'); await page.waitForSelector('#programYes');
  const pt = await page.textContent('#plan');
  ok('M2: update lists a muscle change', /muscle: none to (Chest|Back|Quads)/.test(pt));
  ok('M2: update lists Pullups as new on Pull under Back', /Pullups \(Pull, Back/.test(pt));
  ok('M2: update lists the squat group', /Hack Squat \/ Leg Press/.test(pt));
  await page.click('#programYes'); await settle(page);
  const after = await store(page);
  ok('M3: sessions, notes and progress are untouched', keep(before) === keep(after));
  ok('M3: every exercise id from before still exists', Object.keys(before.custom).filter(id => id !== 'pl_row').every(id => after.custom[id]));
  ok('M3: Pullups is on Pull under Back', after.custom.c_mwgzonul && after.custom.c_mwgzonul.day === 'pull' && after.custom.c_mwgzonul.muscle === 'Back');
  ok('M3: Hack Squat and Leg Press are one group, Leg Press at both gyms', after.custom.lg_press.grp === 'g_legpress' && after.custom.c_mux7l5fd.grp === 'g_legpress' && after.custom.c_mux7l5fd.rank === 1 && after.custom.lg_press.gym === 'both', JSON.stringify([after.custom.lg_press.gym, after.custom.lg_press.rank]));
  ok('M3: Full Body keeps one squat slot', after.custom.lg_press.fb != null && after.custom.c_mux7l5fd.fb == null);
  ok('M3: Dips is under Triceps', after.custom.c_mw9pjksz.muscle === 'Triceps');

  // ---- Today shows headings in order ----
  await day(page, 'push');
  let f = await flow(page);
  const hd = f.filter(x => x[0] === '#');
  ok('T1: Push headings in order (Minto)', JSON.stringify(hd) === '["#Chest","#Shoulders","#Triceps","#Core"]', JSON.stringify(hd));
  ok('T1: Dips sits under Triceps, Pullups is gone', f.indexOf('Dips') > f.indexOf('#Triceps') && f.indexOf('Dips') < f.indexOf('#Core') && !f.includes('Pullups'));
  await day(page, 'pull'); f = await flow(page);
  ok('T2: Pull headings in order', JSON.stringify(f.filter(x => x[0] === '#')) === '["#Back","#Rear Delts","#Biceps","#Forearms"]', JSON.stringify(f));
  ok('T2: Lat Pulldown first, Pullups right after', f[1] === 'Lat Pulldown' && f[2] === 'Pullups', JSON.stringify(f.slice(0, 5)));
  await day(page, 'legs'); f = await flow(page);
  ok('T3: Legs headings in order', JSON.stringify(f.filter(x => x[0] === '#')) === '["#Squat Movements","#Quads","#Hamstrings","#Hips","#Calves"]', JSON.stringify(f));
  ok('T3: Minto opens on Hack Squat as the first squat movement', f[1] === 'Hack Squat', JSON.stringify(f.slice(0, 3)));
  await page.click('.exhead:has(.exname:text-is("Hack Squat"))');
  ok('T3: Minto dropdown offers Hack Squat then Leg Press', JSON.stringify(await page.$$eval('#msel option', o => o.map(x => x.textContent.replace(/\s*\(.*$/, '')))) === '["Hack Squat","Leg Press"]', JSON.stringify(await page.$$eval('#msel option', o => o.map(x => x.textContent))));
  await reload(page, 'montpetit'); await day(page, 'legs'); f = await flow(page);
  ok('T3: Montpetit shows Leg Press, not Hack Squat', f.includes('Leg Press') && !f.includes('Hack Squat'), JSON.stringify(f.slice(0, 3)));
  await reload(page, 'minto'); await day(page, 'fullbody');
  ok('T4: Full Body has no muscle headings', (await heads(page)).length === 0);

  // ---- Plan tab shows them ----
  await page.click('#nav button[data-tab="plan"]');
  const plan = await page.$$eval('#plan .musclehead', els => els.map(e => e.textContent));
  ok('P1: Plan shows muscle rows for all three days', plan.length === 13 && plan[0] === 'Chest' && plan[12] === 'Calves', JSON.stringify(plan));

  // ---- add form: Muscle dropdown; new exercise lands inside its block ----
  await day(page, 'pull');
  await page.click('#addBtn, button:has-text("Add exercise")');
  await page.fill('#cname', 'Test Pull Over');
  ok('F1: the form has a Muscle dropdown with this day\'s muscles', JSON.stringify(await page.$$eval('#cmuscle option', o => o.map(x => x.textContent))) === '["None","Back","Rear Delts","Biceps","Forearms"]');
  await page.selectOption('#cmuscle', 'Back');
  await page.click('.cform .save');
  await settle(page);
  f = await flow(page);
  ok('F1: new exercise sits at the end of the Back block', f.indexOf('Test Pull Over') > f.indexOf('#Back') && f.indexOf('Test Pull Over') < f.indexOf('#Rear Delts'), JSON.stringify(f));
  ok('F1: muscle saved on the exercise', Object.values((await store(page)).custom).some(d => d.name === 'Test Pull Over' && d.muscle === 'Back'));

  // ---- a new exercise with no muscle goes to the end under Other ----
  await page.click('button:has-text("Add exercise")');
  await page.fill('#cname', 'Test Loose');
  await page.click('.cform .save'); await settle(page);
  f = await flow(page);
  ok('F2: no muscle shows under Other at the end', f[f.length - 2] === '#Other' && f[f.length - 1] === 'Test Loose', JSON.stringify(f.slice(-3)));

  // ---- survives a reload and never touches history ----
  await reload(page);
  await day(page, 'pull'); f = await flow(page);
  ok('R1: headings survive a reload', f.includes('#Back') && f.includes('#Biceps'));
  const fin = await store(page);
  ok('R1: sessions, notes and progress still untouched', keep(before) === keep(fin));
  ok('R1: no page errors', errs.length === 0, errs.join(' | '));

  // ---- version 7: Ab Crunch removed, history kept, two machines join dropdowns ----
  const v7 = rd('program-v7.json');
  const hadAbsLog = Object.values(fin.sessions || {}).filter(x => x.log && x.log.p_abs).length;
  setProg(v7); await reload(page);
  ok('V7: update banner shows', await page.isVisible('#programBanner'));
  await page.click('#programBanner'); await page.waitForSelector('#programYes');
  ok('V7: update lists Ab Crunch Machine as removed', (await page.textContent('#plan')).includes('Ab Crunch Machine'));
  await page.click('#programYes'); await settle(page);
  const s7 = await store(page);
  ok('V7: Ab Crunch exercise is gone', !s7.custom.p_abs);
  ok('V7: its past logs are still in the sessions', Object.values(s7.sessions || {}).filter(x => x.log && x.log.p_abs).length === hadAbsLog);
  ok('V7: sessions, notes and progress untouched', keep(fin) === keep(s7));
  ok('V7: Standup Curls joined Cable Curls, upper back rows joined the row group', s7.custom.c_mwl7twys && s7.custom.c_mwl7twys.grp === 'g_cablecurl' && s7.custom.c_mwmgqk1l && s7.custom.c_mwmgqk1l.grp === 'g_row');
  ok('V7: other incline presses warm up 1', ['c_mu0fanxt', 'c_mu6a0yyd', 'c_mw9osbjk'].every(i => !s7.custom[i] || s7.custom[i].warmup === 1));
  await day(page, 'push'); f = await flow(page);
  ok('V7: Core now has no Ab Crunch', !f.includes('Ab Crunch Machine'));
  await reload(page); await day(page, 'fullbody');
  ok('V7: Full Body still opens', (await names(page)).length >= 8);

  await browser.close(); killSrv();
  const fails = results.filter(r => r[0] === 'FAIL');
  results.forEach(r => console.log(r[0] + '  ' + r[1] + (r[2] && r[0] === 'FAIL' ? '  -> ' + r[2] : '')));
  console.log(`\n${results.length - fails.length}/${results.length} passed`);
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.log('CRASH', e); killSrv(); process.exit(1); });
