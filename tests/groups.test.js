// Tests machine groups (one exercise, a Machine dropdown). Run from the repo root:
// SITE=. NODE_PATH=$(npm root -g) node tests/groups.test.js
// It uses tests/fake-test-data.json (made-up data) and the frozen program files program-v1/v2/v3.json.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const BACKUP = path.resolve(process.env.TRACKER_BACKUP || path.join(__dirname, 'fake-test-data.json'));
const SITE = path.resolve(process.env.SITE || '.');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'grpsite-'));
fs.cpSync(SITE, TMP, { recursive: true, filter: s => !/[\\/](\.git|tests|private)([\\/]|$)/.test(s) });
const rd = f => JSON.parse(fs.readFileSync(path.join(__dirname, f)));
const v1 = rd('program-v1.json'), v2 = rd('program-v2.json'), v3 = rd('program-v3.json');
const setProg = o => fs.writeFileSync(path.join(TMP, 'program.json'), JSON.stringify(o));
const clone = o => JSON.parse(JSON.stringify(o));
const results = [];
const ok = (n, c, x = '') => { results.push([c ? 'PASS' : 'FAIL', n, x]); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = +process.env.PORT || (20000 + Math.floor(Math.random() * 20000)), URL_ = `http://localhost:${PORT}/`;

let srv;
const killSrv = () => { try { if (srv) { if (process.platform === 'win32') require('child_process').execSync('taskkill /pid ' + srv.pid + ' /T /F', { stdio: 'ignore' }); else srv.kill(); } } catch (e) {} };

(async () => {
  srv = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', TMP], { stdio: 'ignore' });
  await sleep(800);
  const browser = await chromium.launch();
  const errs = [];
  const store = p => p.evaluate(() => JSON.parse(localStorage.getItem('pplx2:data:v1') || '{}'));
  const setStore = (p, fn) => p.evaluate(f => { const s = JSON.parse(localStorage.getItem('pplx2:data:v1') || '{}'); (new Function('s', f))(s); localStorage.setItem('pplx2:data:v1', JSON.stringify(s)); }, fn.toString().replace(/^[^{]*\{/, '').replace(/\}\s*$/, ''));
  const names = p => p.$$eval('.exlist .exname', els => els.map(e => e.textContent));
  const settle = p => p.waitForFunction(() => document.getElementById('sync').textContent === 'All saved', null, { timeout: 15000 });
  const pick = async (p, g) => { await p.click(`#gymPick button[data-gym="${g}"]`); };
  const reload = async (p, g = 'minto') => { await p.reload(); await pick(p, g); await p.waitForTimeout(1000); };
  const day = async (p, d) => { await p.click('#nav button[data-tab="today"]'); await p.click(`#daySeg button[data-day="${d}"]`); };
  const planText = async p => { await p.click('#nav button[data-tab="plan"]'); return p.textContent('#plan'); };
  const optTexts = p => p.$$eval('#msel option', os => os.map(o => o.textContent));
  const logOne = async p => { await p.fill('.ex.open .setrow.active input[aria-label="Repetitions"]', '10'); await p.click('.ex.open .setrow.active .logbtn'); await p.click('#restSkip'); await settle(p); };
  const grpCard = p => p.click('.exhead:has(.exsub:text("machines")) >> nth=0');
  const byName = (p, n) => p.click(`.exhead:has(.exname:text-is("${n}"))`);
  const d0 = new Date(), today = d0.getFullYear() + '-' + String(d0.getMonth() + 1).padStart(2, '0') + '-' + String(d0.getDate()).padStart(2, '0');
  const orderOf = (s, d) => Object.keys(s.custom).filter(id => s.custom[id].day === d).sort((a, b) => s.custom[a].order - s.custom[b].order);

  // a phone at program version 2 with the fake data restored
  setProg(v1);
  const ctx = await browser.newContext({ viewport: { width: 400, height: 850 } });
  const page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
  await page.goto(URL_); await pick(page, 'minto'); await page.waitForTimeout(500);
  await page.click('#nav button[data-tab="plan"]');
  await page.setInputFiles('#restoreFile', BACKUP); await page.waitForSelector('#restoreYes');
  await Promise.all([page.waitForNavigation(), page.click('#restoreYes')]);
  await pick(page, 'minto'); await page.waitForTimeout(1000);
  setProg(v2); await reload(page);
  await page.click('#programBanner'); await page.waitForSelector('#programYes'); await page.click('#programYes'); await settle(page);
  ok('G0: phone is at program version 2', await page.evaluate(() => localStorage.getItem('pplx2:programApplied')) === '2');
  ok('G0: no groups exist yet', Object.values((await store(page)).custom).every(d => !d.grp));

  // G1 files that are refused
  const refuse = async (name, mut, phrase) => {
    const f = clone(v3); f.version = 10; mut(f); setProg(f);
    await reload(page);
    const t = await planText(page);
    ok('G1: ' + name, !(await page.isVisible('#programBanner')) && t.includes('problem') && t.includes(phrase), t.slice(t.indexOf('Program update'), t.indexOf('Program update') + 260));
    await page.click('#nav button[data-tab="today"]');
  };
  await refuse('an exercise in two groups', f => { f.groups[1].members = ['pl_reardelt', 'c_mw02qgc9']; }, 'more than one machine group');
  await refuse('a group mixing days', f => { f.groups[3].members = ['lg_press', 'pl_curl']; }, 'different days');
  await refuse('a member that is removed', f => { f.exercises = f.exercises.filter(e => e.id !== 'c_mu227o0i'); f.removed.push('c_mu227o0i'); }, 'not an exercise');
  await refuse('a group of one', f => { f.groups[4].members = ['pl_curl']; }, 'at least 2');
  await refuse('an unknown member', f => { f.groups[4].members = ['pl_curl', 'zz_nope']; }, 'not an exercise');
  await refuse('two machines of one group in Full Body', f => { f.fullBody = f.fullBody.concat(['c_mu21v74p']); }, 'two machines of the same group');
  await refuse('an empty group name', f => { f.groups[0].name = ''; }, 'invalid name');
  await refuse('the same group id twice', f => { f.groups[1].id = 'g_row'; }, 'appears twice');
  await refuse('a group on the Any day', f => { f.exercises.find(e => e.id === 'c_mu227o0i').day = 'any'; f.exercises.find(e => e.id === 'pl_curl').day = 'any'; }, 'different days, or is not on Push');
  ok('G1: nothing changed by any refused file', Object.values((await store(page)).custom).every(d => !d.grp));

  // G2 apply version 3
  setProg(v3);
  const before = await store(page);
  await reload(page);
  ok('G2: banner shows version 3', (await page.isVisible('#programBanner')) && (await page.textContent('#programBanner')).includes('version 3'));
  await page.click('#programBanner'); await page.waitForSelector('#programYes');
  const sec = await page.textContent('#programSection');
  ok('G2: update screen lists the five groups, best first', sec.includes('Machine groups') && sec.includes('Closed Grip Row: 1. Seated Row: AP 2500 (Minto), 2. Seated Row: SP-5900 (Minto), 3. Seated Row: FUSE XL (Minto), 4. Dumbbell Rows') && ['Rear Delts', 'Incline Press', 'Leg Press or Hack Squat', 'Cable Curls'].every(n => sec.includes(n + ':')), sec.slice(0, 900));
  ok('G2: lists the new row machine, the removal and the Full Body slot', sec.includes('Seated Row: AP 2500 (Pull') && sec.includes('Seated Cable Row') && sec.includes('6. Closed Grip Row'), sec.slice(0, 1200));
  ok('G2: nothing changed before tapping Apply', Object.values((await store(page)).custom).every(d => !d.grp) && !!(await store(page)).custom.pl_row);
  await page.click('#programYes'); await settle(page);
  const after = await store(page);
  ok('G2: groups stored on each machine, rank = position', ['c_mw02qgc9', 'c_mu21v74p', 'c_mubm1edn', 'c_mv18thxb'].every((id, i) => after.custom[id].grp === 'g_row' && after.custom[id].gname === 'Closed Grip Row' && after.custom[id].rank === i + 1));
  ok('G2: Seated Cable Row removed, history kept', !after.custom.pl_row && JSON.stringify(after.sessions) === JSON.stringify(before.sessions) && JSON.stringify(after.progress) === JSON.stringify(before.progress) && JSON.stringify(after.notes) === JSON.stringify(before.notes));
  ok('G2: Full Body slot 6 is now the row group, still 11 slots', after.custom.c_mw02qgc9.fb === 60 && Object.values(after.custom).filter(d => d.fb != null).length === 11);
  ok('G2: gym tags and equipment text applied', after.custom.c_mu21v74p.gym === 'minto' && after.custom.lg_press.gym === 'montpetit' && after.custom.c_mux7l5fd.warmup === 1 && after.custom.pl_pulldown.gear === 'Lat Pulldown' && after.custom.lg_legcurl.gear === 'Leg Curl' && after.custom.lg_legext.gear === 'Leg Extension');
  ok('G2: machines of a group sit together on Pull, best first', JSON.stringify(orderOf(after, 'pull').slice(0, 8)) === JSON.stringify(['pl_pulldown', 'c_mw02qgc9', 'c_mu21v74p', 'c_mubm1edn', 'c_mv18thxb', 'pl_reardelt', 'c_mu22ps4p', 'c_mubmpybd']), orderOf(after, 'pull').join());
  ok('G2: safety copy holds the old docs', await page.evaluate(() => { const b = JSON.parse(localStorage.getItem('pplx2:before-program') || '{}'); return !!(b.custom && b.custom.pl_row && !b.custom.c_mw02qgc9 && b.appliedVersion === 2); }));
  await reload(page);
  ok('G2: no banner again after reload (applied once)', !(await page.isVisible('#programBanner')));

  // G3 which machine each card opens on, per gym
  await day(page, 'pull');
  let n = await names(page);
  ok('G3: Minto Pull opens Closed Grip Row on AP 2500, one card for the group', n.includes('Seated Row: AP 2500') && !n.includes('Seated Row: SP-5900') && !n.includes('Dumbbell Rows') && !n.includes('Seated Cable Row'), n.join(' | '));
  ok('G3: Minto Pull shows Rear Delt Reverse Fly and Cable Bicep Curl once each', n.filter(x => x === 'Rear Delt Reverse Fly').length === 1 && n.filter(x => x === 'Cable Bicep Curl').length === 1);
  await day(page, 'push'); n = await names(page);
  ok('G3: Minto Push opens Incline Press on the Smith machine', n[0] === 'Incline Bench Press' && !n.includes('Incline Dumbbell Press'), n.join(' | '));
  await day(page, 'legs'); n = await names(page);
  ok('G3: Minto Legs shows Hack Squat only (Leg Press is Montpetit)', n[0] === 'Hack Squat' && !n.includes('Leg Press'), n.join(' | '));
  await reload(page, 'montpetit'); await day(page, 'pull'); n = await names(page);
  ok('G3: Montpetit Pull falls to Dumbbell Rows (the rest are Minto only)', n.includes('Dumbbell Rows') && !n.includes('Seated Row: AP 2500'), n.join(' | '));
  await day(page, 'legs'); n = await names(page);
  ok('G3: Montpetit Legs shows Leg Press', n[0] === 'Leg Press' && !n.includes('Hack Squat'), n.join(' | '));
  await reload(page, 'other'); await day(page, 'pull'); n = await names(page);
  ok('G3: Other opens Closed Grip Row on a machine not tied to one gym (Dumbbell Rows)', n.includes('Dumbbell Rows') && !n.includes('Seated Row: AP 2500'), n.join(' | '));
  await grpCard(page);
  ok('G3: Other lists every machine in the dropdown', (await optTexts(page)).length === 4);
  await day(page, 'legs'); n = await names(page);
  ok('G3: Other Legs defaults to Leg Press (best ranked)', n[0] === 'Leg Press', n.join(' | '));
  await reload(page, 'all'); await day(page, 'pull'); n = await names(page);
  ok('G3: All gyms opens on rank 1 (AP 2500)', n.includes('Seated Row: AP 2500'), n.join(' | '));
  await reload(page, 'minto');

  // G4 the dropdown
  await day(page, 'pull'); await grpCard(page);
  const opts = await optTexts(page);
  ok('G4: Minto dropdown lists the four row machines in order with gym tags', JSON.stringify(opts) === JSON.stringify(['Seated Row: AP 2500 (Minto)', 'Seated Row: SP-5900 (Minto)', 'Seated Row: FUSE XL (Minto)', 'Dumbbell Rows']), opts.join(' | '));
  ok('G4: card says how many machines', (await page.textContent('.exhead:has(.exsub:text("machines")) .exsub')).includes('4 machines'));
  await reload(page, 'montpetit'); await day(page, 'pull'); await byName(page, 'Dumbbell Rows');
  ok('G4: a group with one machine at this gym shows no dropdown', !(await page.$('#msel')) && !(await page.textContent('.ex.open .exsub')).includes('machines'));
  await reload(page, 'minto');

  // G5 logging on a machine that is not the default
  await day(page, 'pull'); await grpCard(page);
  await page.selectOption('#msel', 'c_mu21v74p');
  ok('G5: picking SP-5900 switches the card', (await names(page)).includes('Seated Row: SP-5900') && !(await names(page)).includes('Seated Row: AP 2500'));
  await logOne(page);
  const s5 = await store(page);
  ok('G5: the set is logged against SP-5900 only', (s5.sessions[today + '_pull'].log.c_mu21v74p || []).filter(Boolean).length === 1 && !s5.sessions[today + '_pull'].log.c_mw02qgc9 && s5.progress.c_mu21v74p.date === today && s5.progress.c_mu21v74p.name === 'Seated Row: SP-5900');
  ok('G5: the session remembers the pick', JSON.stringify(s5.sessions[today + '_pull'].pick) === JSON.stringify({ g_row: 'c_mu21v74p' }), JSON.stringify(s5.sessions[today + '_pull']));
  ok('G5: logging did not touch the other machine history', JSON.stringify(s5.progress.c_mw02qgc9 || null) === JSON.stringify(after.progress.c_mw02qgc9 || null) && JSON.stringify(s5.progress.c_mubm1edn) === JSON.stringify(after.progress.c_mubm1edn));
  await page.selectOption('#msel', 'c_mw02qgc9');
  await logOne(page);
  ok('G5: logging on AP 2500 too keeps both, and says so', (await page.textContent('.ex.open')).includes('Also logged today: Seated Row: SP-5900') && !!(await store(page)).sessions[today + '_pull'].log.c_mw02qgc9);
  await page.click('#nav button[data-tab="history"]'); await page.waitForTimeout(500);
  const hist = await page.textContent('#history');
  ok('G5: History shows each machine by its own name', hist.includes('Seated Row: SP-5900') && hist.includes('Seated Row: AP 2500'));

  // G6 picks survive a reload, and a manual pick beats "already logged"
  await day(page, 'pull'); await grpCard(page);
  await page.selectOption('#msel', 'c_mu21v74p');
  await reload(page); await day(page, 'pull'); n = await names(page);
  ok('G6: the pick survives a reload', n.includes('Seated Row: SP-5900') && !n.includes('Seated Row: AP 2500'), n.join(' | '));
  await page.evaluate(() => { const c = JSON.parse(localStorage.getItem('pplx2:v1') || '{}'); delete c.picks; localStorage.setItem('pplx2:v1', JSON.stringify(c)); });
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('pplx2:data:v1')); for (const k in s.sessions) delete s.sessions[k].pick; localStorage.setItem('pplx2:data:v1', JSON.stringify(s)); });
  await reload(page); await day(page, 'pull'); n = await names(page);
  ok('G6: with no saved pick, a session that already has sets opens on the machine logged (best rank first)', n.includes('Seated Row: AP 2500'), n.join(' | '));
  ok('G6: sessions saved before this version (no pick) still load', (await store(page)).sessions['2026-09-14_pull'] !== undefined && n.length > 3);

  // G7 done state and the next card
  await grpCard(page);
  await page.selectOption('#msel', 'c_mu21v74p');
  await logOne(page);
  ok('G7: after the last set the app opens the next card', (await page.textContent('.ex.open .exname')) === 'Rear Delt Reverse Fly', await page.textContent('.ex.open .exname'));
  ok('G7: the group counts as done and the tally says so', (await page.isVisible('.ex.done .exname:text-is("Seated Row: SP-5900")')) && (await page.textContent('#tally')).startsWith('1/'), await page.textContent('#tally'));
  await grpCard(page); await page.selectOption('#msel', 'c_mubm1edn');
  ok('G7: still done after switching to a machine with no sets (the exercise was done)', (await page.isVisible('.ex.done')) && (await page.textContent('#tally')).startsWith('1/'));
  await page.selectOption('#msel', 'c_mu21v74p');

  // G8 a group with no machine at this gym is hidden
  await setStore(page, () => { s.custom.c_mux7l5fd.gym = 'montpetit'; s.custom.lg_press.gym = 'montpetit'; });
  await reload(page); await day(page, 'legs'); n = await names(page);
  ok('G8: Minto shows no card when no machine of the group is here', !n.includes('Hack Squat') && !n.includes('Leg Press'), n.join(' | '));
  await setStore(page, () => { s.custom.c_mux7l5fd.gym = 'minto'; s.custom.lg_press.gym = 'montpetit'; });
  await reload(page);

  // G9 Full Body
  await day(page, 'fullbody'); n = await names(page);
  ok('G9: Full Body at Minto shows 10 cards (Cable Lateral Raise is tagged Montpetit) and the row group only once', n.length === 10 && !n.includes('Cable Lateral Raise') && n.filter(x => /^Seated Row/.test(x)).length === 1 && !n.includes('Seated Cable Row'), n.join(' | '));
  await byName(page, 'Seated Row: AP 2500');
  ok('G9: Full Body card has the dropdown with the Minto machines', (await optTexts(page)).length === 4);
  const open9 = await page.textContent('.ex.open');
  ok('G9: Full Body still hides Delete, Move and Add', !open9.includes('Delete exercise') && !open9.includes('Move up') && !open9.includes('Move down') && !(await page.$('.addbtn')));

  // G10 Plan tab
  const plan = await planText(page);
  ok('G10: Plan shows the group once with its machines in order', plan.includes('Closed Grip Row') && plan.includes('4 machines, best first') && plan.includes('1. Seated Row: AP 2500 (Minto only)') && plan.includes('4. Dumbbell Rows'), plan.slice(0, 300));
  ok('G10: Plan Full Body table lists the group, not Seated Cable Row', !plan.includes('Seated Cable Row'));

  // G11 move a group as one block
  await day(page, 'pull'); await grpCard(page);
  await page.click('.ex.open button:has-text("Move down")'); await page.waitForTimeout(300);
  let s11 = await store(page);
  ok('G11: moving down moves the whole group after the Rear Delts group', JSON.stringify(orderOf(s11, 'pull').slice(0, 8)) === JSON.stringify(['pl_pulldown', 'pl_reardelt', 'c_mu22ps4p', 'c_mubmpybd', 'c_mw02qgc9', 'c_mu21v74p', 'c_mubm1edn', 'c_mv18thxb']), orderOf(s11, 'pull').join());
  await page.click('.ex.open button:has-text("Move up")'); await page.waitForTimeout(300);
  s11 = await store(page);
  ok('G11: moving up puts it back', JSON.stringify(orderOf(s11, 'pull').slice(0, 5)) === JSON.stringify(['pl_pulldown', 'c_mw02qgc9', 'c_mu21v74p', 'c_mubm1edn', 'c_mv18thxb']), orderOf(s11, 'pull').join());

  // G12 backup then restore keeps the group fields
  const gfields = s => JSON.stringify(Object.keys(s.custom).sort().map(id => [id, s.custom[id].grp, s.custom[id].gname, s.custom[id].rank, s.custom[id].fb]));
  const bk = await store(page);
  await page.click('#nav button[data-tab="plan"]');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#backupBtn')]);
  const dlPath = path.join(os.tmpdir(), 'grp-backup-' + Date.now() + '.json'); await dl.saveAs(dlPath);
  await page.setInputFiles('#restoreFile', dlPath); await page.waitForSelector('#restoreYes');
  await Promise.all([page.waitForNavigation(), page.click('#restoreYes')]);
  await pick(page, 'minto'); await page.waitForTimeout(1000);
  ok('G12: backup then restore keeps grp, gname, rank and the Full Body slots', gfields(await store(page)) === gfields(bk) && Object.values((await store(page)).custom).some(d => d.grp === 'g_row'));
  fs.unlinkSync(dlPath);

  // G13 editing a machine keeps its group; changing its day takes it out
  await day(page, 'pull'); await byName(page, 'Cable Bicep Curl');
  await page.click('.ex.open button:has-text("Edit name, gym")');
  await page.fill('#cname', 'Cable Bicep Curl X'); await page.click('.ex.open >> text=Save changes'); await settle(page);
  let s13 = await store(page);
  ok('G13: an edit keeps grp, gname and rank', s13.custom.pl_curl.name === 'Cable Bicep Curl X' && s13.custom.pl_curl.grp === 'g_cablecurl' && s13.custom.pl_curl.rank === 1 && s13.custom.pl_curl.gname === 'Cable Curls');
  await page.click('.ex.open button:has-text("Edit name, gym")');
  await page.click('.ex.open .seg button:text-is("Push")'); await page.click('.ex.open >> text=Save changes'); await settle(page);
  s13 = await store(page);
  ok('G13: moving a machine to another day in the edit form takes it out of the group', s13.custom.pl_curl.day === 'push' && !s13.custom.pl_curl.grp && !s13.custom.pl_curl.gname && !s13.custom.pl_curl.rank && s13.custom.c_mu227o0i.grp === 'g_cablecurl');
  await day(page, 'pull'); n = await names(page);
  ok('G13: the one machine left shows as a plain card, no dropdown', n.includes('Cable Rope Curls') && !(await page.textContent('.exhead:has(.exname:text-is("Cable Rope Curls")) .exsub')).includes('machines'));

  // G14 Belongs to takes a machine out of the group
  await grpCard(page); await page.selectOption('#msel', 'c_mv18thxb');
  await page.click('.ex.open .exfoot .seg button:text-is("Legs")'); await settle(page);
  const s14 = await store(page);
  ok('G14: Belongs to another day detaches the machine', s14.custom.c_mv18thxb.day === 'legs' && !s14.custom.c_mv18thxb.grp && s14.custom.c_mu21v74p.grp === 'g_row');

  // G15 deleting the machine that holds the Full Body slot hands the slot on
  await day(page, 'pull'); await grpCard(page);
  await page.selectOption('#msel', 'c_mw02qgc9');
  await page.click('.ex.open button.del'); await page.click('.ex.open button.del'); await settle(page);
  const s15 = await store(page);
  ok('G15: AP 2500 deleted, its Full Body slot passes to the next machine', !s15.custom.c_mw02qgc9 && s15.custom.c_mu21v74p.fb === 60 && Object.values(s15.custom).filter(d => d.fb != null).length === 11, JSON.stringify([s15.custom.c_mu21v74p.fb]));
  await day(page, 'fullbody'); n = await names(page);
  ok('G15: Full Body at Minto still has 10 cards and now opens the row on SP-5900', n.length === 10 && n.filter(x => /^Seated Row/.test(x)).join() === 'Seated Row: SP-5900', n.join(' | '));
  ok('G15: History for AP 2500 sets is kept', (await store(page)).sessions[today + '_pull'].log.c_mw02qgc9.length === 1);

  const real = errs.filter(e => !/ERR_|fonts|Failed to load/.test(e));
  ok('no page errors', real.length === 0, real.join(' | '));
  await browser.close(); killSrv();
  console.log(results.map(r => r.join('  ')).join('\n'));
  console.log(results.filter(r => r[0] === 'FAIL').length + ' failed of ' + results.length);
})().catch(e => { killSrv(); console.log(results.map(r => r.join('  ')).join('\n')); console.error(e.stack || e.message); process.exit(1); });
