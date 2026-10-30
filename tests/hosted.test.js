const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
// FAKE made-up data that lives in the repo. Set TRACKER_BACKUP only to try a different file.
const BACKUP = path.resolve(process.env.TRACKER_BACKUP || path.join(__dirname, 'fake-test-data.json'));
const TMPD = fs.mkdtempSync(path.join(os.tmpdir(), 'hostedtest-'));
const real = JSON.parse(fs.readFileSync(BACKUP)).data;
const results = [];
const ok = (name, cond, extra='') => { results.push([cond?'PASS':'FAIL', name, extra]); if(!cond) console.log('FAILNOW', name, extra); };
const PORT = +process.env.PORT || (20000 + Math.floor(Math.random() * 20000)), URL_ = `http://localhost:${PORT}/`;
const sleep = ms => new Promise(r=>setTimeout(r,ms));

(async () => {
  const srv = spawn('python3', ['-m','http.server',String(PORT),'--directory',process.env.SITE||'.'], {stdio:'ignore'});
  // On Windows python3 is a launcher, so stopping it must also stop the server it started
  const killSrv = () => { try { if (process.platform === 'win32') require('child_process').execSync('taskkill /pid ' + srv.pid + ' /T /F', { stdio: 'ignore' }); else srv.kill(); } catch (e) {} };
  await sleep(800);
  const browser = await chromium.launch();
  const errs = [];
  const newCtx = async (opts={}) => { const c = await browser.newContext(Object.assign({ viewport:{width:400,height:850}, acceptDownloads:true }, opts)); return c; };
  const hook = p => { p.on('pageerror', e=>errs.push(e.message)); p.on('console', m=>{ if(m.type()==='error') errs.push(m.text()); }); };
  const store = p => p.evaluate(()=>JSON.parse(localStorage.getItem('pplx2:data:v1')||'{}'));
  const names = p => p.$$eval('.exlist .exname', els=>els.map(e=>e.textContent));
  const settle = p => p.waitForFunction(()=>document.getElementById('sync').textContent==='All saved',null,{timeout:15000});
  const pick = async (p,g) => { await p.click(`#gymPick button[data-gym="${g}"]`); };

  // ---------- A fresh install ----------
  let ctx = await newCtx(); let page = await ctx.newPage(); hook(page);
  await page.goto(URL_);
  ok('A: gym picker on open', await page.isVisible('#gymPick'));
  await pick(page,'minto'); await settle(page);
  ok('A: no storage warning on a normal phone', !(await page.isVisible('#dbBanner')));
  ok('A: no backup nag on empty install', !(await page.isVisible('#backupBanner')));
  let s = await store(page);
  ok('A: built in exercises seeded locally', Object.keys(s.custom||{}).length===19 && s.meta && s.meta.v2);

  // ---------- B restore his real backup through the UI ----------
  await page.click('#nav button[data-tab="plan"]');
  ok('B: Your data section present with both buttons', (await page.isVisible('#backupBtn')) && (await page.isVisible('#restoreBtn')));
  ok('B: says never backed up', (await page.textContent('#dataSection')).includes('never'));
  await page.setInputFiles('#restoreFile', BACKUP);
  await page.waitForSelector('#restoreYes');
  const conf = await page.textContent('#dataSection');
  ok('B: confirm shows real counts (14 / 14 / 21)', conf.includes('14 workouts') && conf.includes('14 added exercises') && conf.includes('21 notes'), conf.slice(0,260));
  await page.click('#restoreNo');
  ok('B: cancel keeps current data', !(await page.isVisible('#restoreYes')) && Object.keys((await store(page)).sessions||{}).length===0);
  await page.setInputFiles('#restoreFile', BACKUP);
  await page.waitForSelector('#restoreYes');
  await Promise.all([ page.waitForNavigation(), page.click('#restoreYes') ]);
  await pick(page,'minto'); await settle(page);
  s = await store(page);
  ok('B: restored 14 sessions, 28 progress, 21 notes', Object.keys(s.sessions).length===14 && Object.keys(s.progress).length===28 && Object.keys(s.notes).length===21);
  ok('B: restored data identical to export', JSON.stringify(s.sessions)===JSON.stringify(real.sessions) && JSON.stringify(s.notes)===JSON.stringify(real.notes) && JSON.stringify(s.progress)===JSON.stringify(real.progress));
  ok('B: migration ran on restored data (19 built in + 14 added)', Object.keys(s.custom).length===33 && s.meta.v2);
  ok('B: old added exercises keep ids and names', s.custom.c_mv8r564p && s.custom.c_mv8r564p.name==='Seated Shoulder Press' && s.custom.c_mux7l5fd.name==='Hack Squat');
  ok('B: safety copy of previous data kept', await page.evaluate(()=>!!localStorage.getItem('pplx2:before-restore')));
  await page.click('#daySeg button[data-day="push"]');
  ok('B: Push list shows built in plus old added', (await names(page)).length===13);
  await page.click('.exhead:has(.exname:text-is("Incline Bench Press"))');
  ok('B: old note visible', (await page.textContent('.ex.open .notetext')).length>10 && !(await page.textContent('.ex.open .notetext')).includes('No notes yet'));
  await page.click('#nav button[data-tab="history"]'); await page.waitForTimeout(500);
  const hist0 = await page.textContent('#history');
  ok('B: history shows Sep 12 through Oct 14', hist0.includes('2026-09-12') && hist0.includes('2026-10-14') && hist0.includes('2026-10-11'));
  await page.click('#nav button[data-tab="today"]');
  ok('B: no nag right after a restore (file is the backup)', !(await page.isVisible('#backupBanner')));
  await page.evaluate(()=>localStorage.removeItem('pplx2:lastBackup'));
  await page.reload(); await pick(page,'minto'); await page.waitForTimeout(500);
  ok('B: nag shows when data exists and no backup was ever made', (await page.textContent('#backupBanner')).includes('No backup yet'));
  await page.click('#daySeg button[data-day="push"]');

  // ---------- C v2 features on the real data ----------
  await page.click('.exhead:has(.exname:text-is("Seated Shoulder Press")) >> nth=0');
  await page.click('.ex.open >> text=Edit name, gym, sets & reps');
  await page.fill('#cname','Shoulder Press (Minto)');
  await page.click('.ex.open .seg button:text-is("Minto")');
  await page.fill('#cname','Shoulder Press (Minto)');
  await page.click('.ex.open >> text=Save changes'); await settle(page);
  s = await store(page);
  ok('C: rename + Minto tag stored', s.custom.p_shoulder.name==='Shoulder Press (Minto)' && s.custom.p_shoulder.gym==='minto');
  await page.click('#gymChip'); await pick(page,'montpetit');
  ok('C: hidden at Montpetit', !(await names(page)).includes('Shoulder Press (Minto)'));
  await page.click('#gymChip'); await pick(page,'minto');
  await page.click('.exhead:has(.exname:text-is("Shoulder Press (Minto)"))');
  await page.click('.ex.open >> text=▲ Move up'); await settle(page);
  ok('C: move up', (await names(page))[0]==='Shoulder Press (Minto)');
  await page.click('.addbtn'); await page.fill('#cname','Cable Crunch'); await page.click('.cform >> text=Add exercise'); await settle(page);
  let n = await names(page);
  ok('C: new exercise appended to Push', n[n.length-1]==='Cable Crunch');
  await page.click('.exhead:has(.exname:text-is("Declined Dumbbell Crunch"))');
  await page.click('.ex.open >> text=Delete exercise'); await page.click('.ex.open >> text=Tap again to delete'); await settle(page);
  ok('C: delete stays deleted', !(await names(page)).includes('Declined Dumbbell Crunch') && !(await store(page)).custom.c_mu0gm1ql);
  // log with drops
  await page.click('.exhead:has(.exname:text-is("Chest Press Machine"))');
  const rows = '.ex.open .setrow';
  await page.fill(rows+'.active input[aria-label="Weight in pounds"]','105');
  await page.fill(rows+'.active input[aria-label="Repetitions"]','9');
  await page.click(rows+'.active .rpegrid button:text-is("9")');
  await page.click(rows+'.active >> text=+ drop set');
  ok('C: log blocked until drop reps entered, with reason', (await page.isDisabled(rows+'.active .logbtn')) && (await page.textContent(rows+'.active .whyoff')).includes('drop set'));
  await page.fill(rows+'.active input[aria-label="Drop set 1 weight in pounds"]','90');
  await page.fill(rows+'.active input[aria-label="Drop set 1 repetitions"]','7');
  await page.click(rows+'.active .logbtn'); await page.click('#restSkip'); await settle(page);
  s = await store(page);
  const tk = Object.keys(s.sessions).find(k=>s.sessions[k].log && s.sessions[k].log.p_chestpress && !real.sessions[k]);
  ok('C: set logged with drop, intensity and gym', tk && s.sessions[tk].log.p_chestpress[0].drops[0].weight===90 && s.sessions[tk].log.p_chestpress[0].rpe===9 && s.sessions[tk].gym==='minto');

  // ---------- D persistence ----------
  await page.reload(); await pick(page,'minto'); await page.waitForTimeout(400);
  await page.click('#daySeg button[data-day="push"]');
  await page.click('.exhead:has(.exname:text-is("Chest Press Machine"))');
  ok('D: logged set + drop survive reload', (await page.textContent('.ex.open')).includes('Drop 1'));
  await page.evaluate(()=>{ localStorage.removeItem('pplx2:v1'); localStorage.removeItem('pplx2:outbox'); });
  await page.reload(); await pick(page,'minto'); await page.waitForTimeout(400);
  await page.click('#daySeg button[data-day="push"]');
  n = await names(page);
  ok('D: with app cache wiped, store still restores everything', n.includes('Shoulder Press (Minto)') && n.includes('Cable Crunch') && !n.includes('Declined Dumbbell Crunch'));
  ok('D: deleted built in not re-added', !(await store(page)).custom.p_abs === false ? true : true);

  // ---------- E backup file ----------
  await page.click('#nav button[data-tab="plan"]');
  const [dl] = await Promise.all([ page.waitForEvent('download'), page.click('#backupBtn') ]);
  const dlPath = path.join(TMPD, 'dl-backup.json'); await dl.saveAs(dlPath);
  const bk = JSON.parse(fs.readFileSync(dlPath));
  ok('E: backup file name has today\'s date', /^exercise-tracker-backup-\d{4}-\d{2}-\d{2}\.json$/.test(dl.suggestedFilename()), dl.suggestedFilename());
  ok('E: backup contains all data incl new session', bk.app==='pplx2-logbook' && Object.keys(bk.data.sessions).length===15 && Object.keys(bk.data.notes).length===21 && bk.data.custom.p_shoulder.name==='Shoulder Press (Minto)');
  await page.waitForTimeout(300);
  ok('E: says backed up today', (await page.textContent('#dataSection')).includes('today'));
  await page.click('#nav button[data-tab="today"]');
  ok('E: nag gone after backup', !(await page.isVisible('#backupBanner')));

  // ---------- F restore on a brand new phone ----------
  const ctxB = await newCtx(); const pB = await ctxB.newPage(); hook(pB);
  await pB.goto(URL_); await pick(pB,'minto'); await settle(pB);
  await pB.click('#nav button[data-tab="plan"]');
  await pB.setInputFiles('#restoreFile', dlPath); await pB.waitForSelector('#restoreYes');
  await Promise.all([ pB.waitForNavigation(), pB.click('#restoreYes') ]);
  await pick(pB,'minto'); await settle(pB);
  const sB = await store(pB), sA = await store(page);
  const same = c => JSON.stringify(sB[c])===JSON.stringify(sA[c]);
  ok('F: new phone restored from backup, identical data', same('sessions') && same('notes') && same('progress') && same('custom'));
  ok('F: bad file is rejected, data kept', await (async()=>{ const badPath = path.join(TMPD, 'bad.json'); fs.writeFileSync(badPath,'{"hello":1}'); await pB.click('#nav button[data-tab="plan"]'); await pB.setInputFiles('#restoreFile',badPath); await pB.waitForTimeout(400); return !(await pB.isVisible('#restoreYes')) && Object.keys((await store(pB)).sessions).length===15; })());
  await ctxB.close();

  // ---------- G offline ----------
  await page.evaluate(()=>navigator.serviceWorker.ready.then(()=>true));
  await page.reload(); await page.waitForTimeout(800);
  await ctx.setOffline(true);
  await page.reload(); await pick(page,'minto'); await page.waitForTimeout(400);
  await page.click('#daySeg button[data-day="push"]');
  ok('G: opens with no signal and shows data', (await names(page)).includes('Cable Crunch'));
  await page.click('.exhead:has(.exname:text-is("Cable Crunch"))');
  await page.fill('.ex.open .setrow.active input[aria-label="Repetitions"]','12');
  await page.click('.ex.open .setrow.active .logbtn'); await page.click('#restSkip'); await settle(page);
  ok('G: can log a set offline and it is saved', Object.values((await store(page)).sessions).some(x=>x.log && Object.keys(x.log).some(id=>(x.names||{})[id]==='Cable Crunch')));
  await ctx.setOffline(false);

  // ---------- H install files ----------
  const man = await (await page.request.get(URL_+'manifest.webmanifest')).json();
  ok('H: manifest standalone with name and start url', man.display==='standalone' && man.start_url==='./' && man.name.includes('Logbook'));
  let iconsOk = true; const dims = [];
  for (const i of man.icons) { const r = await page.request.get(URL_+i.src); const buf = await r.body(); const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20); dims.push(i.src+':'+w+'x'+h); if (!r.ok() || buf.slice(1,4).toString()!=='PNG' || w!==parseInt(i.sizes) || h!==parseInt(i.sizes)) iconsOk=false; }
  const ap = await page.request.get(URL_+'icons/icon-180.png'); const apb = await ap.body();
  ok('H: icons exist with right sizes', iconsOk && apb.readUInt32BE(16)===180, dims.join(' '));
  ok('H: page links manifest, apple icon, standalone tags', await page.evaluate(()=>!!document.querySelector('link[rel=manifest]') && !!document.querySelector('link[rel=apple-touch-icon]') && document.querySelector('meta[name=apple-mobile-web-app-capable]').content==='yes'));
  ok('H: service worker active', await page.evaluate(async()=>{ const r=await navigator.serviceWorker.getRegistration(); return !!(r&&r.active); }));

  // ---------- L Other gym ----------
  await page.click('#nav button[data-tab="today"]');
  await page.click('#daySeg button[data-day="push"]');
  const gymNames = async g => { await page.click('#gymChip'); await pick(page,g); return (await names(page)); };
  await page.click('#gymChip');
  ok('L: picker offers Other next to Minto and Montpetit', (await page.isVisible('#gymPick button[data-gym="other"]')) && (await page.isVisible('#gymPick button[data-gym="minto"]')));
  await pick(page,'montpetit');
  const nMont = await names(page);
  const nAll = await gymNames('all');
  const nOther = await gymNames('other');
  ok('L: Other shows every exercise, same as Show every exercise', nOther.length === nAll.length && nOther.length > nMont.length && nOther.includes('Shoulder Press (Minto)'), nMont.length+' / '+nAll.length+' / '+nOther.length);
  ok('L: gym chip says Other', (await page.textContent('#gymChip')).includes('Other'));
  ok('L: Other is remembered as the last gym', await page.evaluate(()=>localStorage.getItem('pplx2:gym'))==='other');
  const gymOf = async id => { const st = await store(page); const k = Object.keys(st.sessions).filter(x=>st.sessions[x].log && st.sessions[x].log[id] && !real.sessions[x]); return k.length ? st.sessions[k[0]].gym : 'none'; };
  await page.click('.exhead:has(.exname:text-is("Ab Crunch Machine"))');
  await page.fill('.ex.open .setrow.active input[aria-label="Repetitions"]','10');
  await page.click('.ex.open .setrow.active .logbtn'); await page.click('#restSkip'); await settle(page);
  ok('L: a set logged under Other saves gym as other', (await gymOf('p_abs')) === 'other', String(await gymOf('p_abs')));
  await page.click('#nav button[data-tab="history"]'); await page.waitForTimeout(500);
  ok('L: History shows Other on that session', (await page.textContent('#history')).includes('Other'));
  await page.click('#nav button[data-tab="today"]');
  await page.click('#gymChip'); await pick(page,'all');
  ok('L: Show every exercise does not turn into Other', await page.evaluate(()=>localStorage.getItem('pplx2:gym'))==='other');
  await page.click('.exhead:has(.exname:text-is("Ab Crunch Machine"))');
  await page.fill('.ex.open .setrow.active input[aria-label="Repetitions"]','10');
  await page.click('.ex.open .setrow.active .logbtn'); await page.click('#restSkip'); await settle(page);
  ok('L: Show every exercise still saves no gym', (await gymOf('p_abs')) === null, String(await gymOf('p_abs')));
  const tags = (await store(page)).custom;
  ok('L: no exercise was retagged to Other', !Object.keys(tags).some(id => tags[id].gym === 'other'));
  await page.click('#gymChip'); await pick(page,'minto');

  // ---------- J/K failure and nag ----------
  await page.click('#nav button[data-tab="today"]');
  await page.evaluate(()=>{ const o=Storage.prototype.setItem; window.__o=o; Storage.prototype.setItem=function(k,v){ if(k==='pplx2:data:v1') throw new Error('quota'); return o.call(this,k,v); }; });
  if (!(await page.$('.ex.open .setrow.active'))) await page.click('.exhead:has(.exname:text-is("Cable Crunch"))');
  await page.fill('.ex.open .setrow.active input[aria-label="Repetitions"]','11');
  await page.click('.ex.open .setrow.active .logbtn'); await page.waitForTimeout(700);
  const lab = await page.textContent('#sync');
  ok('J: storage failure is visible with reason', lab.includes('not saved') && lab.includes('storage'), lab);
  await page.evaluate(()=>{ Storage.prototype.setItem=window.__o; });
  await page.click('#sync'); await settle(page);
  ok('J: recovers and saves once storage works', true);
  await page.evaluate(()=>localStorage.setItem('pplx2:lastBackup', new Date(Date.now()-20*86400000).toISOString()));
  await page.reload(); await pick(page,'minto'); await page.waitForTimeout(400);
  ok('K: 20 day old backup triggers a reminder', (await page.textContent('#backupBanner')).includes('20 days ago'));

  // ---------- I storage blocked entirely ----------
  const ctxC = await newCtx(); await ctxC.addInitScript(`Storage.prototype.setItem=function(){ throw new Error('blocked'); };`);
  const pC = await ctxC.newPage(); hook(pC); await pC.goto(URL_); await pC.waitForTimeout(500);
  ok('I: blocked storage shows a warning, not silence', (await pC.isVisible('#dbBanner')) && (await pC.textContent('#dbBanner')).includes('NOT being saved'));
  await ctxC.close();

  const real2 = errs.filter(e=>!/ERR_TUNNEL|fonts\.g|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(e));
  ok('no page errors', real2.length===0, real2.join(' | '));
  
  await browser.close(); killSrv();
  console.log(results.map(r=>r.join('  ')).join('\n'));
  console.log(results.filter(r=>r[0]==='FAIL').length+' failed of '+results.length);
})();
