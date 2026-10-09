/**
 * QTE 的手機版 (簽章與 field/qte.ts 相同，用 vite alias 換掉)：
 * 每一波顯示對方的台詞 + 3 個回應，限時選；選對進下一波，選錯或逾時就失敗。
 * 呼叫端 (小朋友、第二天小朋友、老鷹) 完全不用改。
 */
export interface QteOpts {
  speaker: string;
  lines: string[];
  hint?: string;
  onStep?: (i: number) => void;
  slow?: number;
  /** 自訂每一波的回應 (沒給就用小朋友的回應池) */
  responses?: { good: string[]; bad: string[] };
  onDone: (ok: boolean) => void;
}

const KID_GOOD = [
  '「這台很貴，碰壞了哥哥要賠一年薪水，站這邊看就好。」',
  '「等我量完，讓你們從螢幕看衛星好不好？」',
  '「你們叫什麼名字？當我的小幫手，幫我看有沒有人靠近。」',
  '「來，站到黃線外面，我告訴你這是在量什麼。」',
  '「這個不能摸，但你們可以幫我數天上有幾顆衛星。」',
];
const KID_BAD = [
  '「走開啦！」',
  '（不理他們，繼續看手簿）',
  '「看一下就好，不要太久喔。」',
  '「你們老師沒教嗎？」',
  '「好啦好啦，只能摸一下。」',
  '「再過來我叫警察！」',
];

let active = false;
export function qteActive() { return active; }

export function runQTE(o: QteOpts) {
  if (active) return;
  active = true;
  if (document.exitPointerLock) document.exitPointerLock();
  document.body.classList.add('bench-active', 'qte-active');
  const root = document.createElement('div');
  root.className = 'qte m-qte';
  root.innerHTML = `
    <div class="qte-speaker">${o.speaker}</div>
    <div class="qte-line"></div>
    <div class="m-qte-timer"><i></i></div>
    <div class="m-qte-opts"></div>
    <div class="qte-dots">${o.lines.map(() => '<i></i>').join('')}</div>
    <div class="qte-hint">${o.hint || '限時選一個回應。'}</div>`;
  document.body.appendChild(root);
  const lineEl = root.querySelector('.qte-line') as HTMLElement;
  const bar = root.querySelector('.m-qte-timer i') as HTMLElement;
  const optsEl = root.querySelector('.m-qte-opts') as HTMLElement;
  const dots = [...root.querySelectorAll('.qte-dots i')] as HTMLElement[];
  const pool = o.responses || { good: KID_GOOD, bad: KID_BAD };
  const usedGood = new Set<number>();
  let round = 0, t0 = 0, limit = 4, raf = 0, done = false, picking = false;


  const finish = (ok: boolean) => {
    if (done) return;
    done = true;
    cancelAnimationFrame(raf);
    root.classList.add(ok ? 'win' : 'lose');
    setTimeout(() => {
      root.remove();
      document.body.classList.remove('qte-active', 'bench-active');
      active = false;
      o.onDone(ok);
    }, ok ? 500 : 900);
  };

  const pick = <T,>(arr: T[], n: number, avoid?: Set<number>): { v: T; i: number }[] => {
    const idx = arr.map((_, i) => i).filter(i => !avoid || !avoid.has(i)).sort(() => Math.random() - 0.5);
    return idx.slice(0, n).map(i => ({ v: arr[i], i }));
  };

  let choices: { t: string; ok: boolean }[] = [];
  const next = () => {
    if (round >= o.lines.length) { finish(true); return; }
    lineEl.textContent = o.lines[round];
    const good = pick(pool.good, 1, usedGood)[0] || pick(pool.good, 1)[0];
    usedGood.add(good.i);
    const bads = pick(pool.bad, 2);
    choices = [{ t: good.v, ok: true }, ...bads.map(b => ({ t: b.v, ok: false }))].sort(() => Math.random() - 0.5);
    optsEl.innerHTML = '';
    choices.forEach(c => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'm-qte-opt';
      b.textContent = c.t;
      b.onclick = (e) => {
        e.stopPropagation();
        if (done || picking) return;
        picking = true;
        cancelAnimationFrame(raf);
        const btns = [...optsEl.children] as HTMLElement[];
        btns.forEach(el => ((el as HTMLButtonElement).disabled = true));
        if (c.ok) {
          b.classList.add('right');
          btns.forEach(el => { if (el !== b) el.classList.add('fade'); });
          dots[round]?.classList.add('ok');
          o.onStep?.(round);
          setTimeout(() => { picking = false; round++; next(); tick(); }, 650);
        } else {
          b.classList.add('wrong');
          // 把正確答案標出來，不然玩家不知道自己選錯在哪
          btns.forEach((el, i) => { if (choices[i].ok) el.classList.add('right'); else if (el !== b) el.classList.add('fade'); });
          dots[round]?.classList.add('bad');
          setTimeout(() => finish(false), 1500);
        }
      };
      optsEl.appendChild(b);
    });
    limit = Math.max(2.2, 4.2 - round * 0.4) * ((window as unknown as { __qteSlow?: number }).__qteSlow || 1) * (o.slow || 1);
    t0 = performance.now();
  };

  const tick = () => {
    if (done || picking) return;
    const k = (performance.now() - t0) / 1000 / limit;
    bar.style.width = `${Math.max(0, 100 - k * 100)}%`;
    bar.classList.toggle('late', k > 0.65);
    if (k >= 1) {
      dots[round]?.classList.add('bad');
      [...optsEl.children].forEach((el, i) => { if (choices[i]?.ok) el.classList.add('right'); else el.classList.add('fade'); (el as HTMLButtonElement).disabled = true; });
      picking = true;
      setTimeout(() => { picking = false; finish(false); }, 1500);
      return;
    }
    raf = requestAnimationFrame(tick);
  };

  next();
  tick();
}
