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
import { bench } from '../field/bench';
import { commandMenu, type CommandMenu, type MenuBtn } from './sheet';
import { gameIntro } from './intro';
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
    // 第二天的水準儀整平也走同一套面板 (桌機是 bench.enter('tribrach'))
    const b = bench as AnyObj;
    const origEnter = b.enter.bind(b);
    const origExit = b.exit.bind(b);
    const self2 = this;
    b.enter = (mode: string, g: AnyObj, o: AnyObj = {}) => {
      if (mode === 'tribrach') {
        b.mode = 'tribrach';
        self2.tribrach(g, {
          noPlummet: !!o.noPlummet, title: o.title,
          onDone: () => { b.mode = null; o.onDone?.(); },
        });
        return;
      }
      return origEnter(mode, g, o);
    };
    b.exit = (ok?: boolean) => {
      if (self2.active) { self2.exit(); b.mode = null; return; }
      return origExit(ok);
    };
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

  exit() { this.menu?.close(); this.menu = null; (bench as AnyObj).mode = null; }

  // ================================================================
  // 1. 基座定心定平
  // ================================================================
  tribrach(g: AnyObj, opts: TribrachOpts = {}) {
    const lvOnly = !!opts.noPlummet;
    gameIntro({
      key: lvOnly ? 'level' : 'tribrach',
      title: lvOnly ? '整平水準儀' : '基座定心定平',
      sub: lvOnly ? '把氣泡趕進黑圈，儀器才是水平的' : '先讓儀器對準標石中心，再把它整平',
      lines: lvOnly
        ? ['畫面上是三顆<b>腳螺旋</b>和一個<b>圓水準器</b>。',
          '用手指<b>繞著腳螺旋轉圈</b>，就能把它旋進旋出。',
          '一次轉一顆，把氣泡慢慢趕進<b>中間的黑圈</b>。',
          '氣泡進圈後按<b>「鎖定」</b>完成。']
        : ['畫面上是三顆<b>腳螺旋</b>、一個<b>圓水準器</b>，和一個<b>光學對點器</b>。',
          '對點器裡的<b>黑點</b>要進<b>紅圈</b>：直接用手指把畫面<b>拖</b>過去（等於平移基座）。',
          '氣泡要進黑圈：用手指<b>繞著腳螺旋轉圈</b>，一次轉一顆。',
          '兩個都好了再按<b>「鎖定」</b>。對心和整平會互相影響，要來回調幾次。'],
      short: lvOnly ? '轉腳螺旋（手指繞圈）把氣泡趕進黑圈，再按「鎖定」。' : '拖畫面對心、轉腳螺旋整平，兩個都好再按「鎖定」。',
      onStart: () => this.tribrachGo(g, opts),
    });
  }

  private tribrachGo(g: AnyObj, opts: TribrachOpts = {}) {
    this.exit();
    g.recalculateTribrachPhysics?.();
    const np = !!opts.noPlummet;
    let warned = false;
    // 第一次定心定平：在旋鈕和對點器上放動畫提示
    let hint = true;
    try { hint = !localStorage.getItem('ks-m-tri-hint'); } catch { /* 無痕模式 */ }

    // ---- 斜看視角的基座：盤面 + 三角分布的腳螺旋 + 圓水準器 ----
    const PK = 0.42;                      // 斜看時 y 方向的壓縮
    // 腳螺旋在圓盤外側的三角底板角上 (不然後面那顆會被盤子擋住)
    const KN: Record<string, { x: number; y: number }> = {
      A: { x: 78, y: 126 }, B: { x: 262, y: 126 }, C: { x: 170, y: 40 },
    };
    const knobSvg = (k: 'A' | 'B' | 'C') => {
      const { x, y } = KN[k];
      return `<g class="m-knob" data-s="${k}">
        <path d="M${x - 27} ${y} v15 a27 11 0 0 0 54 0 v-15z" class="k-side"/>
        <path d="M${x - 18} ${y + 6} v14M${x - 6} ${y + 9} v14M${x + 6} ${y + 9} v14M${x + 18} ${y + 6} v14" class="k-knurl"/>
        <ellipse cx="${x}" cy="${y}" rx="27" ry="11" class="k-top"/>
        <g class="k-ticks" data-k="${k}"></g>
        <ellipse cx="${x}" cy="${y}" rx="9.5" ry="4" class="k-hub"/>
        <text x="${x}" y="${y + 3.4}" class="k-label">${k}</text>
      </g>`;
    };
    const scene = `<div class="m-tri3d">
      <svg viewBox="0 0 340 196" class="m-tri-svg">
        <ellipse cx="170" cy="166" rx="122" ry="22" class="t-shadow"/>
        ${knobSvg('C')}
        <path d="M78 126 L170 40 L262 126 L170 152 Z" class="t-arms"/>
        <path d="M74 95 A96 41 0 0 0 266 95 L266 108 A96 41 0 0 1 74 108 Z" class="t-side"/>
        <ellipse cx="170" cy="95" rx="96" ry="41" class="t-plate"/>
        <ellipse cx="170" cy="95" rx="78" ry="32" class="t-plate2"/>
        <g class="t-vial">
          <ellipse cx="170" cy="88" rx="34" ry="15" class="v-glass"/>
          <ellipse cx="170" cy="88" rx="10" ry="4.4" class="v-ring"/>
          <ellipse class="v-bub" cx="170" cy="88" rx="7.5" ry="3.7"/>
        </g>
        ${knobSvg('A')}${knobSvg('B')}
        ${hint ? `<g class="m-tri-tip" aria-hidden="true">
          <ellipse cx="${KN.A.x}" cy="${KN.A.y}" rx="34" ry="14.3" class="tip-ring"/>
          <circle r="6" class="tip-dot"><animateMotion dur="2.4s" repeatCount="indefinite"
            path="M ${KN.A.x + 34} ${KN.A.y} A 34 14.3 0 1 1 ${KN.A.x - 34} ${KN.A.y} A 34 14.3 0 1 1 ${KN.A.x + 34} ${KN.A.y}"/></circle>
          <text x="${KN.A.x}" y="${KN.A.y + 42}" class="tip-text">手指轉圈</text>
        </g>` : ''}
      </svg>
      <div class="m-tri-hint">手指在 A／B／C 旋鈕上轉圈＝轉動腳螺旋</div>
    </div>`;
    const S = 44;
    const dot = (x: number, y: number) => `cx="${(60 + Math.max(-1.3, Math.min(1.3, x)) * S).toFixed(1)}" cy="${(60 + Math.max(-1.3, Math.min(1.3, y)) * S).toFixed(1)}"`;
    const pips = `<div class="m-pips">
      ${np ? '' : `<figure class="m-plum"><svg viewBox="0 0 120 120" class="m-pip">
        <circle cx="60" cy="60" r="56" class="bg"/>
        <circle cx="60" cy="60" r="${0.10 * S}" class="tol"/>
        <path d="M60 6V52M60 68V114M6 60H52M68 60H112" class="ret"/>
        <circle class="mark" ${dot(g.centerX, g.centerY)} r="5.5"/>
        ${hint ? `<g class="m-tri-tip" aria-hidden="true">
          <path d="M86 36 L44 78" class="tip-path"/>
          <circle r="7" class="tip-dot"><animateMotion dur="2s" repeatCount="indefinite" keyPoints="0;1;0" keyTimes="0;0.5;1" calcMode="linear" path="M 86 36 L 44 78"/></circle>
        </g>` : ''}
      </svg><figcaption>光學對點器<b class="v-cerr">${g.currentCenterErrorMm} mm</b><small>拖曳＝平移基座</small></figcaption></figure>`}
      <figure><svg viewBox="0 0 120 120" class="m-pip vial">
        <circle cx="60" cy="60" r="56" class="bg"/>
        <circle cx="60" cy="60" r="${0.10 * S}" class="ring"/>
        <circle class="bubble" ${dot(g.bubbleX, g.bubbleY)} r="7.5"/>
      </svg><figcaption>圓水準器<b class="v-lerr">${g.currentLevelErrorMm} mm</b><small>放大看</small></figcaption></figure>
    </div>`;

    const m = commandMenu({
      title: opts.title || '基座定心、定平',
      sub: np ? '轉腳螺旋把氣泡趕進圈裡' : '拖對點器平移基座、轉腳螺旋把氣泡趕進圈裡',
      cls: 'm-tribrach',
      panel: scene + pips,
      note: np ? '' : '轉腳螺旋會讓對點跑掉一點，兩個要輪流修。',
      buttons: [{ id: 'lock', text: '鎖定', kind: 'primary' }],
      onPick: (id) => { if (id === 'lock') lock(); },
      onClose: () => { clearInterval(timer); if (this.menu === m) this.menu = null; },
    });
    this.menu = m;
    const root = m.root;
    const bub = root.querySelector('.v-bub') as SVGEllipseElement;
    const flat = root.querySelector('.m-pip.vial .bubble') as SVGCircleElement;
    const mark = root.querySelector('.m-pip .mark') as SVGCircleElement | null;
    const lerr = root.querySelector('.v-lerr') as HTMLElement;
    const cerr = root.querySelector('.v-cerr') as HTMLElement | null;

    const update = () => {
      const bx = Math.max(-1.35, Math.min(1.35, g.bubbleX)), by = Math.max(-1.35, Math.min(1.35, g.bubbleY));
      bub.setAttribute('cx', (170 + bx * 20).toFixed(1));
      bub.setAttribute('cy', (88 + by * 20 * PK).toFixed(1));
      bub.classList.toggle('ok', !!g.isLeveled);
      flat.setAttribute('cx', (60 + bx * S).toFixed(1));
      flat.setAttribute('cy', (60 + by * S).toFixed(1));
      lerr.textContent = `${g.currentLevelErrorMm} mm`;
      lerr.classList.toggle('ok', !!g.isLeveled);
      if (mark) {
        mark.setAttribute('cx', (60 + Math.max(-1.3, Math.min(1.3, g.centerX)) * S).toFixed(1));
        mark.setAttribute('cy', (60 + Math.max(-1.3, Math.min(1.3, g.centerY)) * S).toFixed(1));
        mark.classList.toggle('ok', !!g.isCentered);
      }
      if (cerr) { cerr.textContent = `${g.currentCenterErrorMm} mm`; cerr.classList.toggle('ok', !!g.isCentered); }
      (['A', 'B', 'C'] as const).forEach(k => {
        const el = root.querySelector(`.k-ticks[data-k="${k}"]`) as SVGGElement;
        if (!el) return;
        const base = (g[`screw${k}`] || 0) * 36 * Math.PI / 180;
        const { x, y } = KN[k];
        let d = '';
        for (let i = 0; i < 6; i++) {
          const a = base + i * Math.PI / 3;
          d += `M${(x + 14 * Math.cos(a)).toFixed(1)} ${(y + 14 * PK * Math.sin(a)).toFixed(1)}L${(x + 24 * Math.cos(a)).toFixed(1)} ${(y + 24 * PK * Math.sin(a)).toFixed(1)}`;
        }
        el.innerHTML = `<path d="${d}" class="k-tick"/>`;
      });
    };

    // ---- 直接轉旋鈕：手指繞著旋鈕畫圈 ----
    let sound = 0;
    const dropHint = () => {
      if (!hint) return;
      hint = false;
      try { localStorage.setItem('ks-m-tri-hint', '1'); } catch { /* 無痕模式 */ }
      root.querySelectorAll('.m-tri-tip').forEach(e => e.remove());
    };
    const turn = (k: 'A' | 'B' | 'C', deg: number) => {
      dropHint();
      g[`screw${k}`] = (g[`screw${k}`] || 0) + deg / 36;   // 畫面轉多少，螺旋就轉多少
      g.recalculateTribrachPhysics();
      sound += Math.abs(deg);
      if (sound > 22) { sound = 0; audio()?.playScrewRotate?.(); }
      update();
    };
    root.querySelectorAll<SVGGElement>('.m-knob').forEach(el => {
      const k = el.dataset.s as 'A' | 'B' | 'C';
      let last = 0, on = false;
      const ang = (e: PointerEvent) => {
        const r = el.getBoundingClientRect();
        return Math.atan2((e.clientY - (r.top + r.height / 2)) / PK, e.clientX - (r.left + r.width / 2));
      };
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        on = true; last = ang(e); el.classList.add('hold'); dropHint();
        try { el.setPointerCapture(e.pointerId); } catch { /* 合成事件沒有真的指標 */ }
      });
      el.addEventListener('pointermove', (e) => {
        if (!on) return;
        const a = ang(e);
        let d = a - last;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        last = a;
        turn(k, d * 180 / Math.PI);
      });
      const up = (e: PointerEvent) => { on = false; el.classList.remove('hold'); try { el.releasePointerCapture(e.pointerId); } catch { /* ignore */ } };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });

    // ---- 拖對點器 = 平移基座 (黑點跟著手指走) ----
    const plum = root.querySelector('.m-plum .m-pip') as SVGSVGElement | null;
    if (plum) {
      let on = false, px = 0, py = 0;
      plum.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        on = true; px = e.clientX; py = e.clientY;
        try { plum.setPointerCapture(e.pointerId); } catch { /* 合成事件沒有真的指標 */ }
      });
      plum.addEventListener('pointermove', (e) => {
        if (!on) return;
        const r = plum.getBoundingClientRect();
        const per = r.width * S / 120;         // 1 單位 = 幾 px
        g.shiftX -= (e.clientX - px) / per;    // 黑點跟著手指
        g.shiftY -= (e.clientY - py) / per;
        px = e.clientX; py = e.clientY;
        g.recalculateTribrachPhysics();
        update();
      });
      const up = (e: PointerEvent) => { on = false; try { plum.releasePointerCapture(e.pointerId); } catch { /* ignore */ } };
      plum.addEventListener('pointerup', up);
      plum.addEventListener('pointercancel', up);
    }

    // ---- 偶爾來一陣風 ----
    const timer = window.setInterval(() => {
      if (!m.open) return;
      if (roll() < 0.12) {
        const k = ['A', 'B', 'C'][Math.floor(roll() * 3)];
        g[`screw${k}`] += (roll() < 0.5 ? -0.25 : 0.25);
        g.recalculateTribrachPhysics();
        update();
        ui.toast('一陣風吹過來，腳架微微晃了一下……', 'warn', 2200);
      }
    }, 9000);

    const lock = () => {
      const okAll = g.isLeveled && (np || g.isCentered);   // 只定平的場合 (水準儀) 不看對點
      if (!okAll && !warned) {
        warned = true;
        const what = !np && !g.isCentered && !g.isLeveled ? '對心和氣泡都' : !np && !g.isCentered ? '對心' : '氣泡';
        ui.toast(`${what}還沒進圈。確定要這樣鎖定，再按一次「鎖定」。`, 'warn', 3200);
        return;
      }
      clearInterval(timer);
      if (opts.onDone) { audio()?.playSuccessChime?.(); this.exit(); opts.onDone(); return; }
      g.finalCenteringErrorMm = parseFloat(g.currentCenterErrorMm || '0.4');
      g.finalLevelingErrorMm = parseFloat(g.currentLevelErrorMm || '0.1');
      g.currentStep = 2;
      audio()?.playSuccessChime?.();
      if (!okAll) { tell('對心或氣泡還沒進圈就鎖定基座', '定心定平誤差直接進成果'); whatIf('兩個輪流修到都進圈再鎖定，對心 1 mm 以內、氣泡居中。'); }
      this.exit();
      this.app.updateMissionPanel(g.title, g.getTasks(), g.currentStep, `基座已鎖定（對心誤差 ${g.finalCenteringErrorMm} mm、氣泡殘差 ${g.finalLevelingErrorMm} mm）。點儀器量斜高。`);
    };

    update();
  }

  // ================================================================
  // 2. 量天線斜高
  // ================================================================
  tape(g: AnyObj) {
    gameIntro({
      key: 'tape',
      title: '量天線斜高',
      sub: '鋼捲尺從標石頂拉到儀器的量高缺口',
      lines: ['用手指<b>拖畫面</b>，把鋼捲尺的一端對到<b>標石頂</b>。',
        '另一端對到儀器側面的<b>量高缺口</b>。',
        '<b>兩指可以放大</b>，刻度看清楚一點再讀。',
        '讀好之後按<b>「記錄」</b>。'],
      short: '拖畫面對準標石頂和量高缺口，兩指放大看刻度，再按「記錄」。',
      onStart: () => this.tapeGo(g),
    });
  }

  private tapeGo(g: AnyObj) {
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
        { id: 'edge', text: '標石頂面的邊緣' },
        { id: 'ground', text: '標石旁邊的地面' },
      ]), (id) => { zeroId = id; zeroBias = id === 'center' ? 0 : id === 'edge' ? 0.012 : 0.028; step2(); });
    };
    const step2 = () => {
      m.setTitle('量天線斜高', '第 2 步：捲尺往上拉到天線的哪裡？');
      m.setPanel('<div class="m-illus">天線盤側面有一道黃色的量高缺口（ARP 基準緣）、上面是天線頂、下面是底盤外緣。</div>');
      m.setButtons(shuffle([
        { id: 'notch', text: '黃色量高缺口' },
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
        { id: 'redo', text: '重拉一次', kind: 'ghost' },
      ], (id) => { if (id === 'ok') submit(); else step1(); });
      setTimeout(() => inp.focus(), 300);
    };
    step1();
  }

  // ================================================================
  // 3. 手簿靜態觀測
  // ================================================================
  controller(g: AnyObj) {
    gameIntro({
      key: 'controller',
      title: '手簿：開始靜態觀測',
      sub: '點名、天線高輸入好就可以開始記錄',
      lines: ['檢查<b>點名</b>和<b>天線高</b>有沒有填對。',
        '按<b>「開始記錄」</b>，接收儀就開始記歷元。',
        '記錄中<b>不要碰腳架</b>，碰到就要重來。'],
      short: '確認點名和天線高，按「開始記錄」，記錄中別碰腳架。',
      onStart: () => this.controllerGo(g),
    });
  }

  private controllerGo(g: AnyObj) {
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
