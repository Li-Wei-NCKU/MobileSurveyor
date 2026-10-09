/**
 * 測試工具 (F9 開關)：用遊玩的方式除錯，不用每次從頭玩。
 *  - 設定「第一天的結果」(阿伯的回答、阿黃、小朋友) 並解鎖第二天
 *  - 直接開始某一天、或直接到現場 (設備自動裝好)
 *  - 立刻觸發現場事件、一鍵整平、望遠鏡顯示正確讀數、學弟瞬移
 */
import type { GameApp, AnyObj } from './legacy';
import type { FieldDay } from './fieldDay';
import { JOBS, loadProgress, saveProgress, type JobId } from './jobs';
import type { ItemId } from './items';
import * as ui from './ui';
import { showEnding } from './ending';

const dbg: AnyObj = ((window as AnyObj).__ksDebug = (window as AnyObj).__ksDebug || { truth: false });

let panel: HTMLDivElement | null = null;

export function installDebug(app: GameApp, field: FieldDay, showMenu: () => void) {
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'F9') return;
    e.preventDefault();
    e.stopPropagation();
    if (panel) close(); else open(app, field, showMenu);
  }, true);
}

function close() {
  panel?.remove();
  panel = null;
}

function open(app: GameApp, field: FieldDay, showMenu: () => void) {
  if (document.exitPointerLock) document.exitPointerLock();
  const pr = loadProgress();
  const fd = field as AnyObj;
  const inField = app.currentLevelObj === field;
  const job: JobId = field.job;
  const lv = fd.lv as AnyObj;

  panel = document.createElement('div');
  panel.className = 'ks-debug';
  const sel = (id: string, opts: [string, string][], cur: string) =>
    `<select data-k="${id}">${opts.map(([v, t]) => `<option value="${v}"${v === cur ? ' selected' : ''}>${t}</option>`).join('')}</select>`;
  panel.innerHTML = `
    <div class="kd-head"><strong>測試工具</strong><span>F9 關閉</span></div>
    <section>
      <h4>第一天的結果（影響第二天）</h4>
      <label>阿伯　${sel('uncle', [['', '沒遇到阿伯'], ['explain', '好好解釋'], ['order', '出示派工單'], ['lie', '說要開路（騙他）'], ['secret', '說是國家機密'], ['ignore', '不理他']], pr.uncle)}</label>
      <label>阿黃　${sel('dog', [['', '沒遇到'], ['stopped', '被攔住'], ['bumped', '撞到腳架']], pr.dog)}</label>
      <label>小朋友 ${sel('kids', [['', '沒遇到'], ['stopped', '被攔住'], ['bumped', '摸了腳架']], pr.kids)}</label>
      <label>地主／里長 ${sel('owner1', [['', '沒處理'], ['doc', '拿公文'], ['talk', '口頭說明'], ['sorry', '道歉'], ['argue', '頂撞（叫警察）']], pr.owner1 || '')}</label>
      <label>阿姨地界 ${sel('auntie1', [['', '沒遇到'], ['ok', '教她申請鑑界'], ['no', '拒絕'], ['proper', '陪看後說要鑑界'], ['guess', '隨口認界'], ['move-sorry', '動界樁後道歉'], ['move-blame', '動界樁推給阿姨']], pr.auntie1 || '')}</label>
      <h4>第二天的結果（影響第三天）</h4>
      <label>阿伯回訪 ${sel('uncle2', [['', '沒回訪'], ['a', '道歉／說實話／好好聊'], ['b', '沒有']], pr.uncle2 || '')}</label>
      <label>帶學弟 ${sel('mentor2', [['0', '普通'], ['2', '有好好教'], ['-2', '都沒教']], String(Math.max(-2, Math.min(2, Math.round((pr.mentor2 || 0) / 2) * 2))))}</label>
      <p class="kd-note">第三天的起始人情：沒有第三天存檔時，由上面兩天推出來（阿伯 = 第一天的阿伯；村民看地主／里長、阿姨、亂說開路）。「第三天的人情」按鈕會蓋過這個。</p>
      <div class="kd-row">
        <button data-a="save">存檔並解鎖第二天</button>
        <button data-a="save3">存檔並解鎖第三天（清除第三天人情）</button>
        <button data-a="ending">直接看尾聲</button>
        <button data-a="reset" class="kd-ghost">清除進度</button>
      </div>
    </section>
    <section>
      <h4>直接開始</h4>
      <div class="kd-row">
        <button data-a="go-gnss">第一天：從頭</button>
        <button data-a="site-gnss">第一天：直接到現場</button>
      </div>
      <div class="kd-row">
        <button data-a="go-level">第二天：從頭</button>
        <button data-a="site-level">第二天：直接到現場</button>
      </div>
      <div class="kd-row">
        <button data-a="go-gcp">第三天：從頭</button>
        <button data-a="site-gcp">第三天：直接到現場</button>
        <button data-a="unlock3">解鎖第三天</button>
      </div>
      <p class="kd-note">「直接到現場」會把當天需要的設備自動裝上後斗、車停好；路上的東西都跳過。</p>
    </section>
    ${inField && job === 'level' ? `
    <section>
      <h4>第二天現場</h4>
      <div class="kd-row">
        <button data-a="lv-uncle">阿伯馬上出現</button>
        <button data-a="lv-scooter">機車停到視線上</button>
        <button data-a="lv-dog">阿黃馬上來</button>
      </div>
      <div class="kd-row">
        <button data-a="lv-tilt">下一次讀數：尺沒扶直</button>
        <button data-a="lv-level">一鍵整平</button>
        <button data-a="lv-warp">學弟立刻走到</button>
      </div>
      <div class="kd-row">
        <button data-a="lv-police">警察馬上經過（照現況）</button>
        <button data-a="lv-truck">大貨車馬上經過</button>
        <button data-a="lv-kids">小朋友馬上來（交換後）</button>
        <button data-a="lv-wrong">學弟尺立錯（BM-1035）</button>
      </div>
      <div class="kd-row">
        <button data-a="lv-cop-none">警察來：有帶但沒擺</button>
        <button data-a="lv-cop-nohave">警察來：沒帶也沒擺</button>
        <button data-a="lv-cop-wrong">警察來：交通錐擺錯</button>
        <button data-a="lv-cop-ok">警察來：交通錐擺對</button>
      </div>
      <label class="kd-check"><input type="checkbox" data-k="truth"${dbg.truth ? ' checked' : ''}> 望遠鏡裡顯示正確讀數</label>
      <p class="kd-note">阿伯和阿黃的台詞依上面「第一天的結果」決定；改完按「存檔」再觸發。機車、阿黃需要先架好儀器、學弟在立尺。小朋友依「第一天的結果」：被攔住→來幫忙顧尺墊，其他→來踢尺墊。</p>
    </section>` : ''}
    ${inField && job === 'gcp' ? `
    <section>
      <h4>第三天現場</h4>
      <div class="kd-row">
        <button data-a="gc-quick">佈標／RTK 畫面：直接完成</button>
        <button data-a="gc-rtk">每點補上 RTK 和照片</button>
        <button data-a="gc-here">準心這裡直接佈一個標</button>
      </div>
      <div class="kd-row">
        <button data-a="gc-good">一鍵佈好 5 點（好位置）</button>
        <button data-a="gc-bad">一鍵佈好 5 點（全踩坑）</button>
        <button data-a="gc-done">佈標完成，收工</button>
      </div>
      <div class="kd-row">
        <button data-a="gc-ev-farmer">田主阿伯（對最後一個標）</button>
        <button data-a="gc-ev-keeper">廟公（對最後一個標）</button>
        <button data-a="gc-ev-dog">阿黃踩最後一個標</button>
      </div>
      <div class="kd-row">
        <button data-a="gc-ev-tractor">鐵牛車開進農路</button>
        <button data-a="gc-ev-bus">進香團遊覽車</button>
      </div>
      <div class="kd-row">
        <button data-a="gc-ev-rumor">村民問「是不是要徵收」</button>
        <button data-a="gc-ev-crowd">鄉親圍觀最近的標</button>
        <button data-a="gc-ev-kick">圍觀的人踩到沒乾的標</button>
      </div>
      <div class="kd-row">
        <button data-a="gc-ev-parking">路邊停車（停在農路的標上）</button>
        <button data-a="gc-ev-chief">里長打電話到公司</button>
        <button data-a="gc-hammer">收工時學弟一定忘鐵鎚</button>
      </div>
      <div class="kd-row">
        <button data-a="gc-fly">航拍直接完成</button>
        <button data-a="gc-eagle">飛行中：大冠鷲馬上來</button>
        <button data-a="gc-v-grandma">飛行中：阿嬤</button>
        <button data-a="gc-v-keeper">飛行中：廟公叫你移車</button>
      </div>
      <div class="kd-row">
        <button data-a="gc-pool">重抽事件池</button>
        <button data-a="gc-pool-all">事件池全開</button>
        <button data-a="gc-keeper-friend">廟公變朋友（二樓看飛機）</button>
      </div>
      <div class="kd-row">
        <button data-a="gc-rel-clear">人情：清除</button>
        <button data-a="gc-rel-good">人情：全部處得好</button>
        <button data-a="gc-rel-bad">人情：全部得罪</button>
      </div>
      <p class="kd-note">今天抽到的事件：<b>${fd.gcp.ev.poolText()}</b>。人情（存檔）：阿伯 ${loadProgress().rel3?.farmer || '—'}／廟公 ${loadProgress().rel3?.keeper || '—'}／村民 ${loadProgress().rel3?.village || '—'}（改人情後要重新「第三天：直接到現場」才生效）。</p>
      <p class="kd-note">「全踩坑」：農路上、榕樹下、兩塊田裡、菜園。收工後開回公司就能看成果報告。學弟遞錯漆：第一個點四成、第二個點一定（學弟在旁邊才會）。事件每天從 8 個裡抽 3～4 個，F9 可以重抽或全開。</p>
    </section>` : ''}
    ${inField && job === 'gnss' ? `
    <section>
      <h4>第一天現場</h4>
      <div class="kd-row">
        <button data-a="g-setup">一鍵架好儀器（定心定平完成）</button>
        <button data-a="g-uncle">阿伯馬上出現</button>
        <button data-a="g-dog">下一個碰腳架：阿黃</button>
        <button data-a="g-kid">下一個碰腳架：小朋友</button>
      </div>
      <div class="kd-row">
        <button data-a="g-owner">地主／里長再來一次</button>
        <button data-a="g-police">地主報警，警車馬上來</button>
        <button data-a="g-auntie">阿姨馬上騎車來（收工）</button>
      </div>
      <p class="kd-note">碰腳架事件會在定心定平完成後發生（先選阿黃或小朋友，再按一鍵架好）；地主在量完天線高後出現。</p>
    </section>` : ''}
    <p class="kd-msg" aria-live="polite"></p>`;
  document.body.appendChild(panel);
  const msg = (t: string) => { const m = panel?.querySelector('.kd-msg'); if (m) m.textContent = t; };
  const val = (k: string) => (panel!.querySelector(`[data-k="${k}"]`) as HTMLSelectElement).value;

  panel.querySelectorAll<HTMLButtonElement>('button[data-a]').forEach(b => b.onclick = () => {
    const a = b.dataset.a!;
    switch (a) {
      case 'save3':
        saveProgress({ day1Done: true, day2Done: true, uncle: val('uncle'), dog: val('dog') as AnyObj, kids: val('kids') as AnyObj, owner1: val('owner1') as AnyObj, auntie1: val('auntie1'), uncle2: val('uncle2') as AnyObj, mentor2: Number(val('mentor2')) || 0, rel3: undefined });
        msg('已存檔：第三天的起始人情會依第一、二天的結果。');
        return;
      case 'ending':
        close();
        if (fd?.gcp) showEnding(fd.gcp.endingFacts(), () => (window as AnyObj).__showMainMenu?.());
        else showEnding({ rel: loadProgress().rel3 || { farmer: '', keeper: '', village: '' }, metKeeper: true, asst: '宏斌', mentor2: loadProgress().mentor2 || 0, sameAsst: true, serious: false, hammer: '', aeroOk: true }, () => (window as AnyObj).__showMainMenu?.());
        return;
      case 'save':
        saveProgress({ day1Done: true, uncle: val('uncle'), dog: val('dog') as AnyObj, kids: val('kids') as AnyObj });
        if (lv) lv.pr = loadProgress();
        msg('已存檔，第二天已解鎖。');
        if (!inField) { close(); showMenu(); }
        return;
      case 'reset':
        saveProgress({ day1Done: false, day2Done: false, day3Done: false, uncle: '', dog: '', kids: '' });
        msg('進度已清除。');
        return;
      case 'go-gnss': case 'go-level': case 'go-gcp':
        close(); start(app, field, a.slice(3) as JobId, false); return;
      case 'site-gnss': case 'site-level': case 'site-gcp':
        close(); start(app, field, a.slice(5) as JobId, true); return;
      case 'unlock3':
        saveProgress({ day1Done: true, day2Done: true });
        msg('第二天標記完成，第三天已解鎖。');
        if (!inField) { close(); showMenu(); }
        return;
      // ---- 第三天
      case 'gc-quick': msg(fd.gcp.debugQuick()); return;
      case 'gc-rtk': msg(fd.gcp.debugRtkPhotos()); return;
      case 'gc-here': {
        const q = fd.gcp.groundAimFar?.() || null;
        if (!q) { msg('準心要對著地面。'); return; }
        msg(fd.gcp.debugPlace(q.x, q.z, 1)); return;
      }
      case 'gc-good': case 'gc-bad':
        if (!['site', 'observe'].includes(fd.phase)) { msg('要先到第三天的現場（「第三天：直接到現場」）。'); return; }
        msg(fd.gcp.debugAuto(a === 'gc-good' ? 'good' : 'bad')); return;
      case 'gc-done': fd.gcp.debugFinish(); close(); return;
      case 'gc-fly': close(); msg(fd.gcp.debugFly()); return;
      case 'gc-eagle': msg(fd.gcp.uav.debugEagle()); close(); return;
      case 'gc-hammer': (window as AnyObj).__forgetHammer = true; msg('收工時學弟一定會把鐵鎚忘在某個標旁邊。'); return;
      case 'gc-v-grandma': msg(fd.gcp.uav.debugVisit('grandma')); close(); return;
      case 'gc-v-keeper': msg(fd.gcp.uav.debugVisit('keeper')); close(); return;
      case 'gc-pool': fd.gcp.ev.drawPool(); msg(`事件池：${fd.gcp.ev.poolText()}`); return;
      case 'gc-pool-all': fd.gcp.ev.pool = new Set(['dog', 'farmer', 'tractor', 'temple', 'eagle', 'grandma', 'rumor', 'parking']); msg(`事件池：${fd.gcp.ev.poolText()}`); return;
      case 'gc-keeper-friend': fd.gcp.ev.keeperFriend = true; fd.gcp.ev.keeperAnnoyed = false; msg('廟公變朋友了：飛的時候會在二樓幫看老鷹。'); return;
      case 'gc-rel-clear': saveProgress({ rel3: { farmer: '', keeper: '', village: '' } }); msg('人情清除。'); return;
      case 'gc-rel-good': saveProgress({ rel3: { farmer: 'good', keeper: 'good', village: 'good' } }); msg('人情：全部處得好。'); return;
      case 'gc-rel-bad': saveProgress({ rel3: { farmer: 'bad', keeper: 'bad', village: 'bad' } }); msg('人情：全部得罪。'); return;
      case 'gc-ev-rumor': case 'gc-ev-crowd': case 'gc-ev-kick': case 'gc-ev-parking': case 'gc-ev-chief':
      case 'gc-ev-farmer': case 'gc-ev-keeper': case 'gc-ev-dog': case 'gc-ev-tractor': case 'gc-ev-bus': case 'gc-ev-storm': case 'gc-ev-rain':
        if (!['site', 'observe', 'packup'].includes(fd.phase)) { msg('要先到第三天的現場。'); return; }
        msg(fd.gcp.ev.debug(a.slice(6))); return;
      // ---- 第二天
      case 'lv-uncle':
        lv.pr = loadProgress(); lv.uncleDone = false;
        if (fd.phase !== 'observe') fd.phase = 'observe';
        lv.spawnUncle();
        if (lv.pr.uncle === 'ignore' && !(lv.inst && lv.rodAt)) msg('「不理他」版本要先架好儀器、學弟在立尺，阿伯才會去擋視線。');
        else msg('阿伯出發了。'); return;
      case 'lv-scooter':
        if (!lv.inst || !lv.stations.length || lv.swapped) { msg('先在第一站架好儀器（換學弟操作之後就不會有機車了）。'); return; }
        lv.scooterDone = false; lv.spawnScooter(); msg('機車來了。'); return;
      case 'lv-dog':
        if (!lv.inst) { msg('先架好儀器。'); return; }
        lv.pr = loadProgress();
        if (!lv.pr.dog) { msg('「第一天的結果」裡阿黃是「沒遇到」，牠不會出現。先改成「撞到腳架」或「被攔住」並存檔。'); return; }
        lv.dogDone = false; close(); lv.maybeDog(); return;
      case 'lv-cop-none': case 'lv-cop-nohave': case 'lv-cop-wrong': case 'lv-cop-ok':
        if (!['site', 'observe'].includes(fd.phase)) { msg('要先到第二天的現場（「第二天：直接到現場」）。'); return; }
        lv.debugPolice(a === 'lv-cop-none' ? 'none' : a === 'lv-cop-nohave' ? 'nohave' : a === 'lv-cop-wrong' ? 'wrong' : 'ok'); close(); return;
      case 'lv-police':
        lv.policeStage = 'wait'; lv.policeT = 0.1; msg(lv.cones ? '有擺交通錐：警車會巡邏經過。' : '沒擺交通錐：警車會停下來。'); return;
      case 'lv-truck':
        if (!lv.inst) { msg('先架好儀器。'); return; }
        lv.truckDone = true; lv.spawnLorry(); msg('大貨車來了，打開望遠鏡看看。'); return;
      case 'lv-kids':
        if (!lv.kidTarget()) { msg('要在交換角色後、TP1 上只剩標尺的時候才會來。'); return; }
        lv.pr = loadProgress(); lv.kidsDone = false; close(); lv.spawnKids(); return;
      case 'lv-wrong':
        if (lv.swapped || lv.rodAt !== lv.bm1) { msg('學弟要在 BM-1035 立尺時才能用。'); return; }
        lv.rodWrong = true; lv.placeAsstAtRod(); msg('學弟的尺現在立在標石旁的地上。'); return;
      case 'lv-tilt':
        lv.tiltPlanned = lv.readCount + 1; msg('下一次開望遠鏡時，標尺會是歪的。'); return;
      case 'lv-level':
        if (!lv.inst || lv.instState === 'tripod') { msg('還沒裝上水準儀。'); return; }
        Object.assign(lv.lv, { bx0: 0, by0: 0, screwA: 0, screwB: 0, screwC: 0 });
        lv.lv.recalculateTribrachPhysics();
        lv.instState = 'leveled'; lv.nextHint(); msg('已整平。');
        if (!lv.swapped && lv.stations.length === 1 && !lv.scooterDone) setTimeout(() => lv.spawnScooter(), 1500);
        return;
      case 'lv-warp': {
        const as = lv.asst;
        if (as.state !== 'goto') { msg('學弟現在沒有要去哪裡。'); return; }
        as.g.position.set(as.tx, as.g.position.y, as.tz); msg('學弟到了。'); return;
      }
      // ---- 第一天
      case 'g-uncle': fd.events.debugUncle(); msg('阿伯出發了。'); return;
      case 'g-dog': fd.events.debugBump('dog'); msg('定心定平完成後，阿黃會衝過來。'); return;
      case 'g-kid': fd.events.debugBump('kid'); msg('定心定平完成後，小朋友會跑過來。'); return;
      case 'g-setup': msg(fd.debugSetupGnss()); return;
      case 'g-auntie':
        if (!['site', 'observe', 'packup'].includes(fd.phase)) { msg('要先到第一天的現場（「第一天：直接到現場」）。'); return; }
        // 腳架有架就照正常流程收工 (設備擺回控制點旁)，沒架就直接切到收工階段
        if (fd.phase !== 'packup') { if (fd.tripodSet) fd.onGnssDone({ score: 80 }); else fd.setPhase('packup'); }
        fd.events.debugAuntie(); close(); return;
      case 'g-police': fd.events.debugPolice(); msg('地主報警了，警車出發。'); return;
      case 'g-owner': fd.events.debugOwner(); msg('量完天線高後，地主／里長會出現。'); return;
    }
  });
  panel.querySelector<HTMLInputElement>('[data-k="truth"]')?.addEventListener('change', (e) => {
    dbg.truth = (e.target as HTMLInputElement).checked;
  });
}

/** 開始某一天；toSite = 設備自動裝好、車停在現場 */
function start(app: GameApp, field: FieldDay, job: JobId, toSite: boolean) {
  document.querySelectorAll('.field-modal').forEach(e => e.remove());
  ui.dropMenuKeys();
  field.job = job;
  app.loadLevel('field');
  if (!toSite) return;
  const fd = field as AnyObj;
  // 跳過派工單
  ui.dismissWorkOrder();
  fd.setPhase('prep');
  // 從貨架拿走需要的設備，直接放進後斗
  JOBS[job].required.forEach((it: ItemId) => {
    if (fd.grid.has(it)) return;
    const g = fd.ground.find((x: AnyObj) => x.item === it);
    if (g) {
      app.sceneManager.scene.remove(g.obj);
      fd.unregister(g.obj);
      fd.ground = fd.ground.filter((x: AnyObj) => x !== g);
      fd.shelfSpots.forEach((s: AnyObj) => { if (s.uid === g.uid) s.uid = null; });
    }
    const spot = fd.grid.findSpot(it);
    if (spot) fd.loadTrunk(it, spot.col, spot.row, spot.layer, spot.rot);
  });
  const park = JOBS[job].park;
  fd.enterTruck();
  fd.truck.setPose(park.x, park.z, job === 'gnss' ? -Math.PI / 2 : job === 'gcp' ? 0 : 0);
  fd.truck.speed = 0;
  fd.phase = 'toSite';
  fd.exitTruck();
  ui.toast('（測試）已直接到現場，設備在後斗。', 'info', 3000);
}
