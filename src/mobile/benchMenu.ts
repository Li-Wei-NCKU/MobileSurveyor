/**
 * 第一天儀器操作的回合制選單 (取代桌機版 bench.ts 的 3D 近距離操作)：
 *   1. 基座定心定平：平移基座 / 轉腳螺旋 (一般、慢慢轉) / 鎖定 — 物理沿用 LevelGNSS.recalculateTribrachPhysics
 *   2. 量天線斜高：零點壓哪裡 → 拉到哪裡 → 讀捲尺 (放大鏡) — 選錯不提示，報告才看得到
 *   3. 手簿：點名 → 天線高型別 → 開始記錄
 * 評分與存檔欄位 (finalCenteringErrorMm、tapeReadingErrorMm、…) 完全沿用舊版。
 */
import * as THREE from 'three';
import type { GameApp, AnyObj } from '../field/legacy';
import { audio } from '../field/legacy';
import * as ui from '../field/ui';
import { commandMenu, type CommandMenu, type MenuBtn } from './sheet';
import { tell, whatIf } from '../field/story';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

/** 骰子 (測試時可用 window.__ksDebug.seed 固定) */
export function roll(): number {
  const d = (window as AnyObj).__ksDebug;
  if (d && typeof d.seed === 'number') { d.seed = (d.seed * 9301 + 49297) % 233280; return d.seed / 233280; }
  return Math.random();
}

export interface TribrachOpts {
  /** 不需要對點 (水準儀只要定平) */
  noPlummet?: boolean;
  /** 鎖定後呼叫 (取代 GNSS 的步驟推進) */
  onDone?: () => void;
  title?: string;
}

class BenchMenu {
  private app!: GameApp;
  private menu: CommandMenu | null = null;
  get active() { return !!this.menu?.open; }
  /** 給 fieldDay.collidePlayer 之類的檢查用 */
  get mode() { return this.menu?.open ? 'menu' : null; }

  install(app: GameApp) {
    this.app = app;
    const P = (window as AnyObj).LevelGNSS.prototype;
    const self = this;
    P.openTribrachModal = function () { self.tribrach(this); };
    P.openTapeMeasureModal = function () { self.tape(this); };
    P.openGNSSControllerModal = function () { self.controller(this); };
    const start = P.start;
    P.start = function (...a: unknown[]) { self.exit(); (this as AnyObj).nameWrong = ''; (this as AnyObj).htypeWrong = false; (this as AnyObj).tapeZero = ''; (this as AnyObj).tapeTop = ''; return start.apply(this, a); };
    const stop = P.stop;
    P.stop = function (...a: unknown[]) { self.exit(); return stop ? stop.apply(this, a) : undefined; };
  }

  exit() { this.menu?.close(); this.menu = null; }

  // ================================================================
  // 1. 基座定心定平
  // ================================================================
  tribrach(g: AnyObj, opts: TribrachOpts = {}) {
    this.exit();
    g.recalculateTribrachPhysics?.();
    let sub: 'main' | 'shift' | 'screw' = 'main';
    let fine = false, slow = false, turns = 0, warned = false;
    const np = !!opts.noPlummet;
    const m = commandMenu({
      title: opts.title || '基座定心、定平', sub: np ? '轉腳螺旋把氣泡趕進圈裡' : '平移基座對點、轉腳螺旋定平，兩個輪流修',
      cls: 'm-tribrach', buttons: [], onPick: () => {},
      onClose: () => { if (this.menu === m) this.menu = null; },
    });
    this.menu = m;
    const panel = () => {
      const cx = g.centerX, cy = g.centerY, bx = g.bubbleX, by = g.bubbleY;
      const S = 44; // 1 單位 = 44 px
      const dot = (x: number, y: number) => `cx="${(60 + Math.max(-1.3, Math.min(1.3, x)) * S).toFixed(1)}" cy="${(60 + Math.max(-1.3, Math.min(1.3, y)) * S).toFixed(1)}"`;
      const plummet = np ? '' : `
        <figure><svg viewBox="0 0 120 120" class="m-pip">
          <circle cx="60" cy="60" r="56" class="bg"/>
          <circle cx="60" cy="60" r="${0.10 * S}" class="tol"/>
          <path d="M60 6V52M60 68V114M6 60H52M68 60H112" class="ret"/>
          <circle ${dot(cx, cy)} r="5.5" class="mark"/>
        </svg><figcaption>光學對點器<b>${g.currentCenterErrorMm} mm</b></figcaption></figure>`;
      const vial = `
        <figure><svg viewBox="0 0 120 120" class="m-pip vial">
          <circle cx="60" cy="60" r="56" class="bg"/>
          <circle cx="60" cy="60" r="${0.10 * S}" class="ring"/>
          <circle ${dot(bx, by)} r="7.5" class="bubble"/>
        </svg><figcaption>圓水準器<b>${g.currentLevelErrorMm} mm</b></figcaption></figure>`;
      return `<div class="m-pips">${plummet}${vial}</div>`;
    };
    const disturb = () => {
      turns++;
      if (turns % 6 === 0 && roll() < 0.15) {
        const k = ['A', 'B', 'C'][Math.floor(roll() * 3)];
        g[`screw${k}`] += (roll() < 0.5 ? -0.3 : 0.3);
        g.recalculateTribrachPhysics();
        ui.toast('一陣風吹過來，腳架微微晃了一下……', 'warn', 2200);
      }
    };
    const screw = (s: 'A' | 'B' | 'C', d: number) => {
      const amt = slow ? 0.5 * d : d + (roll() - 0.5) * 0.4; // 一般轉有手感誤差
      g[`screw${s}`] += amt;
      audio()?.playScrewRotate?.();
      g.recalculateTribrachPhysics();
      disturb();
      draw();
    };
    const shift = (dx: number, dy: number) => {
      const k = fine ? 0.03 : 0.06;
      g.shiftX += dx * k; g.shiftY += dy * k;
      audio()?.playClick?.();
      g.recalculateTribrachPhysics();
      disturb();
      draw();
    };
    const lock = () => {
      if (!(g.isCentered && g.isLeveled) && !warned) {
        warned = true;
        const what = !g.isCentered && !g.isLeveled ? '對心和氣泡都' : !g.isCentered ? '對心' : '氣泡';
        ui.toast(`${what}還沒進圈。確定要這樣鎖定，再按一次「鎖定」。`, 'warn', 3200);
        return;
      }
      if (opts.onDone) { audio()?.playSuccessChime?.(); this.exit(); opts.onDone(); return; }
      g.finalCenteringErrorMm = parseFloat(g.currentCenterErrorMm || '0.4');
      g.finalLevelingErrorMm = parseFloat(g.currentLevelErrorMm || '0.1');
      g.currentStep = 2;
      audio()?.playSuccessChime?.();
      if (!(g.isCentered && g.isLeveled)) { tell('對心或氣泡還沒進圈就鎖定基座', '定心定平誤差直接進成果'); whatIf('兩個輪流修到都進圈再鎖定，對心 1 mm 以內、氣泡居中。'); }
      this.exit();
      this.app.updateMissionPanel(g.title, g.getTasks(), g.currentStep, `基座已鎖定（對心誤差 ${g.finalCenteringErrorMm} mm、氣泡殘差 ${g.finalLevelingErrorMm} mm）。點儀器量斜高。`);
    };
    const draw = () => {
      if (!m.open) return;
      m.setPanel(panel());
      let btns: MenuBtn[];
      if (sub === 'main') {
        btns = [
          ...(np ? [] : [{ id: 'shift', text: '平移基座', sub: '鬆開中心螺旋，對光學對點器' }]),
          { id: 'screw', text: '轉腳螺旋', sub: '看圓水準器' },
          { id: 'lock', text: '鎖定', kind: 'primary' as const },
        ];
        m.setNote(np ? '' : '轉腳螺旋會讓對點跑掉一點，兩個要輪流修。');
      } else if (sub === 'shift') {
        btns = [
          { id: 'u', text: '▲' }, { id: 'l', text: '◀' }, { id: 'r', text: '▶' }, { id: 'd', text: '▼' },
          { id: 'fine', text: fine ? '微調：開' : '微調：關', kind: 'ghost' },
          { id: 'back', text: '返回', kind: 'ghost' },
        ];
        m.setNote('把對點器裡的黑點移進紅圈。');
      } else {
        btns = [
          { id: 'A+', text: 'A 順轉' }, { id: 'A-', text: 'A 逆轉' },
          { id: 'B+', text: 'B 順轉' }, { id: 'B-', text: 'B 逆轉' },
          { id: 'C+', text: 'C 順轉' }, { id: 'C-', text: 'C 逆轉' },
          { id: 'slow', text: slow ? '慢慢轉：開' : '慢慢轉：關', kind: 'ghost' },
          { id: 'back', text: '返回', kind: 'ghost' },
        ];
        m.setNote('A、B 在前面兩腳，C 在後面。一般轉比較快但手感會有誤差；慢慢轉準但要多轉幾次。');
      }
      m.root.classList.toggle('grid4', sub === 'shift');
      m.root.classList.toggle('grid2', sub === 'screw');
      m.setButtons(btns, (id) => {
        if (id === 'shift') sub = 'shift'; else if (id === 'screw') sub = 'screw'; else if (id === 'back') sub = 'main';
        else if (id === 'lock') { lock(); return; }
        else if (id === 'fine') fine = !fine; else if (id === 'slow') slow = !slow;
        else if (id === 'u') { shift(0, -1); return; } else if (id === 'd') { shift(0, 1); return; }
        else if (id === 'l') { shift(-1, 0); return; } else if (id === 'r') { shift(1, 0); return; }
        else if (/^[ABC][+-]$/.test(id)) { screw(id[0] as 'A', id[1] === '+' ? 1 : -1); return; }
        draw();
      });
    };
    draw();
  }

  // ================================================================
  // 2. 量天線斜高
  // ================================================================
  tape(g: AnyObj) {
    this.exit();
    const t = g.tripodMesh as THREE.Object3D | null;
    const sm = this.app.sceneManager as AnyObj;
    // 真值：標石中心 → 天線量高缺口 (跟桌機版一樣的幾何)
    let L = 1.6843;
    if (t) {
      t.updateMatrixWorld(true);
      const head = t.userData.head as THREE.Object3D | undefined;
      let mon: THREE.Object3D | null = null, bd = Infinity;
      (sm.interactiveObjects as THREE.Object3D[]).forEach(o => { if (o.userData?.type !== 'monument') return; const d = Math.hypot(o.position.x - t.position.x, o.position.z - t.position.z); if (d < bd) { bd = d; mon = o; } });
      const mm = mon as THREE.Object3D | null;
      const M = mm && bd < 1 ? V(mm.position.x, mm.position.y + 0.28, mm.position.z) : V(t.position.x, sm.heightAt(t.position.x, t.position.z), t.position.z);
      if (head) {
        const hi = (head.userData.hiMark as THREE.Vector3) || V(-0.1085, 0.112, 0);
        const N = head.localToWorld(hi.clone());
        L = M.distanceTo(N);
      }
    }
    g.trueSlantHeight = Math.round(L * 10000) / 10000;
    let zeroBias = 0, topBias = 0, zeroId = '', topId = '';
    const m = commandMenu({ title: '量天線斜高', sub: '第 1 步：鋼捲尺的零點壓在哪裡？', cls: 'm-tape', buttons: [], onPick: () => {}, onClose: () => { if (this.menu === m) this.menu = null; } });
    this.menu = m;
    const shuffle = <T,>(a: T[]) => a.slice().sort(() => roll() - 0.5);
    const step1 = () => {
      m.setTitle('量天線斜高', '第 1 步：鋼捲尺的零點壓在哪裡？');
      m.setPanel('<div class="m-illus">標石頂面有個十字刻劃，中心有一個小點。</div>');
      m.setNote('');
      m.root.classList.remove('grid2', 'grid4');
      m.setButtons(shuffle([
        { id: 'center', text: '標石中心的十字點' },
        { id: 'edge', text: '標石頂面的邊緣', sub: '比較好壓' },
        { id: 'ground', text: '標石旁邊的地面' },
      ]), (id) => { zeroId = id; zeroBias = id === 'center' ? 0 : id === 'edge' ? 0.012 : 0.028; step2(); });
    };
    const step2 = () => {
      m.setTitle('量天線斜高', '第 2 步：捲尺往上拉到天線的哪裡？');
      m.setPanel('<div class="m-illus">天線盤側面有一道黃色的量高缺口（ARP 基準緣）、上面是天線頂、下面是底盤外緣。</div>');
      m.setButtons(shuffle([
        { id: 'notch', text: '黃色量高缺口', sub: '天線盤側面的刻線' },
        { id: 'top', text: '天線的頂面' },
        { id: 'rim', text: '底盤的外緣' },
      ]), (id) => { topId = id; topBias = id === 'notch' ? 0 : id === 'top' ? 0.055 : -0.018; step3(); });
    };
    const step3 = () => {
      const shown = L + zeroBias + topBias; // 玩家實際會在捲尺上看到的值
      m.setTitle('量天線斜高', '第 3 步：讀紅線壓到的刻度，估讀到 0.1 mm');
      m.setPanel(`<canvas class="m-tape-cv" width="340" height="240"></canvas>
        <label class="m-input">斜高 <input type="text" inputmode="decimal" autocomplete="off" placeholder="1.xxxx"> m</label>
        <p class="m-fb"></p>`);
      m.setNote('最小刻度 1 mm，長刻度 5 mm，數字是公分。可以用手指上下拖動捲尺。');
      const cv = m.root.querySelector('canvas') as HTMLCanvasElement;
      let off = 0;
      const drawTape = () => {
        const c = cv.getContext('2d')!; const W = cv.width, H = cv.height;
        c.fillStyle = '#1b2430'; c.fillRect(0, 0, W, H);
        const pxPerMm = 9;
        const cy = H / 2 + off;
        c.fillStyle = '#f2c417'; c.fillRect(W / 2 - 60, 0, 120, H);
        const mm0 = Math.round(shown * 1000);
        for (let mm = mm0 - 40; mm <= mm0 + 40; mm++) {
          const y = cy - (mm - shown * 1000) * pxPerMm;
          if (y < -10 || y > H + 10) continue;
          const cm = mm % 10 === 0, five = mm % 5 === 0;
          const len = cm ? 60 : five ? 38 : 22;
          c.fillStyle = '#111'; c.fillRect(W / 2 - 60, y - (cm ? 1.5 : 1), len, cm ? 3 : 2);
          if (cm) { c.fillStyle = mm % 100 === 0 ? '#c1121f' : '#111'; c.font = 'bold 18px "Noto Sans TC",sans-serif'; c.textAlign = 'right'; c.textBaseline = 'middle'; c.fillText(String(mm / 10), W / 2 + 54, y - 11); }
        }
        // 紅色基準線 (量高缺口)
        c.fillStyle = '#e11d48'; c.fillRect(W / 2 - 80, cy - 1.5, 160, 3);
        c.fillStyle = '#e11d48'; c.font = 'bold 13px "Noto Sans TC",sans-serif'; c.textAlign = 'left'; c.textBaseline = 'bottom';
        c.fillText('量高基準線', W / 2 + 64, cy - 4);
      };
      drawTape();
      let drag: { y: number; off: number } | null = null;
      cv.addEventListener('pointerdown', (e) => { drag = { y: e.clientY, off }; cv.setPointerCapture(e.pointerId); });
      cv.addEventListener('pointermove', (e) => { if (!drag) return; off = Math.max(-80, Math.min(80, drag.off + (e.clientY - drag.y))); drawTape(); });
      cv.addEventListener('pointerup', () => { drag = null; });
      const inp = m.root.querySelector('input') as HTMLInputElement;
      const fb = m.root.querySelector('.m-fb') as HTMLElement;
      const submit = () => {
        const v = parseFloat(inp.value || '');
        if (isNaN(v) || v < 1.0 || v > 2.5) { fb.textContent = '請輸入公尺數，估讀到小數點後四位，例如 1.2345。'; fb.className = 'm-fb bad'; return; }
        g.playerInputSlantHeight = v;
        g.tapeReadingErrorMm = parseFloat((Math.abs(v - g.trueSlantHeight) * 1000).toFixed(2));
        g.slantHeightMeasured = true;
        g.tapeZero = zeroId; g.tapeTop = topId;
        if (zeroId !== 'center') { tell(zeroId === 'edge' ? '捲尺零點壓在標石邊緣' : '捲尺零點壓在地面', '斜高多算了一截，垂直天線高跟著錯'); whatIf('零點要壓在標石中心的十字點上，量的才是天線到點位的距離。'); }
        if (topId !== 'notch') { tell(topId === 'top' ? '捲尺拉到天線頂' : '捲尺拉到底盤外緣', '量到的不是 ARP 基準，天線高錯了幾公分'); whatIf('要拉到天線側面的黃色量高缺口（ARP 基準緣）。'); }
        const hv = Math.sqrt(Math.max(0, v * v - 0.14 * 0.14)).toFixed(4);
        fb.textContent = `已記錄 ${v.toFixed(4)} m（垂直高 ${hv} m）`; fb.className = 'm-fb ok';
        audio()?.playSuccessChime?.();
        m.setButtons([], () => {});
        setTimeout(() => {
          g.currentStep = 3;
          this.exit();
          this.app.updateMissionPanel(g.title, g.getTasks(), g.currentStep, `斜高 ${v.toFixed(4)} m 已記錄。點儀器操作手簿開始靜態觀測。`);
        }, 900);
      };
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
      m.setButtons([
        { id: 'ok', text: '記錄', kind: 'primary' },
        { id: 'redo', text: '重拉一次', kind: 'ghost', sub: '回到第 1 步' },
      ], (id) => { if (id === 'ok') submit(); else step1(); });
      setTimeout(() => inp.focus(), 300);
    };
    step1();
  }

  // ================================================================
  // 3. 手簿靜態觀測
  // ================================================================
  controller(g: AnyObj) {
    this.exit();
    const t = g.tripodMesh as THREE.Object3D | null;
    if (t?.userData.accessories) t.userData.accessories.visible = true;
    g.epochsRecorded = 0;
    const m = commandMenu({ title: '手簿：靜態觀測', sub: '第 1 步：點名', cls: 'm-ctrl', buttons: [], onPick: () => {}, onClose: () => { if (this.menu === m) this.menu = null; } });
    this.menu = m;
    const shuffle = <T,>(a: T[]) => a.slice().sort(() => roll() - 0.5);
    let name = '', htype = '';
    const screen = (status: string, pct = 0) => `
      <div class="m-pda">
        <div class="m-pda-row"><span>點名</span><b>${name || '—'}</b></div>
        <div class="m-pda-row"><span>天線高</span><b>${g.playerInputSlantHeight ? `${Number(g.playerInputSlantHeight).toFixed(4)} m` : '—'}${htype ? `（${htype === 'slant' ? '斜高' : '垂直高'}）` : ''}</b></div>
        <div class="m-pda-row"><span>衛星</span><b>${pct > 0 ? 19 : 18}</b></div>
        <div class="m-pda-row"><span>PDOP</span><b>${pct > 0 ? (1.23 + roll() * 0.07).toFixed(2) : '1.28'}</b></div>
        <div class="m-pda-bar"><i style="width:${Math.round(pct * 100)}%"></i></div>
        <div class="m-pda-status">${status}</div>
      </div>`;
    const step1 = () => {
      m.setTitle('手簿：靜態觀測', '第 1 步：點名（這個點叫什麼？）');
      m.setPanel(screen('待命'));
      m.setNote('看派工單、看標石上刻的字。');
      m.setButtons(shuffle([{ id: 'CKSV', text: 'CKSV' }, { id: 'CKSU', text: 'CKSU' }, { id: 'BM-01', text: 'BM-01' }]), (id) => { name = id; step2(); });
    };
    const step2 = () => {
      m.setTitle('手簿：靜態觀測', '第 2 步：天線高輸入');
      m.setPanel(screen('待命'));
      m.setNote(`剛剛捲尺量到 ${g.playerInputSlantHeight ? Number(g.playerInputSlantHeight).toFixed(4) : '—'} m。這個數字是哪一種高？`);
      m.setButtons(shuffle([{ id: 'slant', text: '斜高（Slant）' }, { id: 'vertical', text: '垂直高（Vertical）' }]), (id) => { htype = id; step3(); });
    };
    const step3 = () => {
      m.setTitle('手簿：靜態觀測', '第 3 步：開始記錄');
      m.setPanel(screen('待命'));
      m.setNote('記滿歷元前別碰腳架。');
      m.setButtons([{ id: 'go', text: '開始記錄', kind: 'primary' }], () => record());
    };
    const record = () => {
      if (name !== 'CKSV') { g.nameWrong = name; tell(`手簿點名打成 ${name}`, '觀測檔案的點名錯了，內業要重新對'); whatIf('點名要跟派工單、標石上的刻字一致：CKSV。'); }
      if (htype !== 'slant') { g.tapeReadingErrorMm = (g.tapeReadingErrorMm || 0) + 5.8; g.htypeWrong = true; tell('捲尺量的是斜高，手簿卻輸入「垂直高」', '天線高少了近 6 mm，高程跟著錯'); whatIf('捲尺從標石拉到天線缺口量的是斜高，要選斜高讓手簿自己換算。'); }
      audio()?.playClick?.();
      m.setButtons([], () => {});
      m.setNote('記錄中……接收儀正在收衛星訊號。這段時間腳架被碰到就要重來。');
      let tt = 0, beep = 0;
      const t0 = performance.now();
      let last = t0;
      const tick = () => {
        if (!m.open) return;
        const now = performance.now();
        const dt = Math.min(0.1, (now - last) / 1000); last = now;
        tt += dt; beep += dt;
        g.epochsRecorded = Math.min(g.targetEpochs, Math.round(g.targetEpochs * tt / 5));
        if (beep > 0.35) { beep = 0; audio()?.playLaserBeep?.(); }
        // 被碰腳架：舊版 bump 會把 currentStep 打回 1
        if (g.currentStep < 3) { this.exit(); ui.toast('觀測中斷！腳架被碰到，重新定心定平後再來。', 'bad', 3500); return; }
        m.setPanel(screen(g.epochsRecorded >= g.targetEpochs ? 'RINEX 已儲存' : `● 記錄中　${g.epochsRecorded} / ${g.targetEpochs} 歷元`, g.epochsRecorded / g.targetEpochs));
        if (g.epochsRecorded >= g.targetEpochs) {
          audio()?.playSuccessChime?.();
          setTimeout(() => { this.exit(); g.finishLevel(); }, 1200);
          return;
        }
        setTimeout(tick, 90);
      };
      tick();
    };
    step1();
  }
}

export const benchMenu = new BenchMenu();
(window as AnyObj).__benchMenu = benchMenu;
