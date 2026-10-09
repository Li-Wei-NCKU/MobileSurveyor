/**
 * 底部面板 (sheet) 與回合制「指令選單」通用元件。
 * 指令選單 = 標題 + 狀態面板 (HTML) + 2～5 個大按鈕，每按一次 = 一回合。
 * 用 .modal-backdrop.show.field-modal 包起來，所以 player.isModalOpen() 會視同有視窗開著，
 * 事件導演 (阿伯、警察…) 會像桌機一樣等你選完。
 */
export interface MenuBtn { id: string; text: string; sub?: string; kind?: 'primary' | 'danger' | 'ghost'; disabled?: string }

export interface CommandMenu {
  root: HTMLElement;
  /** 換狀態面板內容 */
  setPanel(html: string): void;
  /** 換按鈕 */
  setButtons(btns: MenuBtn[], onPick: (id: string) => void): void;
  setTitle(t: string, sub?: string): void;
  setNote(html: string): void;
  close(): void;
  readonly open: boolean;
}

let seq = 0;

export function commandMenu(o: { title: string; sub?: string; panel?: string; note?: string; cls?: string; buttons: MenuBtn[]; onPick: (id: string) => void; onClose?: () => void; closable?: boolean }): CommandMenu {
  const id = `m-cmd-${++seq}`;
  const bd = document.createElement('div');
  bd.className = `modal-backdrop show field-modal m-cmd-backdrop ${o.cls || ''}`;
  bd.id = id;
  bd.innerHTML = `<div class="m-cmd">
    <div class="m-cmd-head"><div><h3></h3><small></small></div>${o.closable === false ? '' : '<button class="m-cmd-x" type="button" aria-label="離開">離開</button>'}</div>
    <div class="m-cmd-panel"></div>
    <div class="m-cmd-note"></div>
    <div class="m-cmd-btns"></div>
  </div>`;
  document.body.appendChild(bd);
  if (document.exitPointerLock) document.exitPointerLock();
  const h3 = bd.querySelector('h3') as HTMLElement, small = bd.querySelector('small') as HTMLElement;
  const panel = bd.querySelector('.m-cmd-panel') as HTMLElement;
  const note = bd.querySelector('.m-cmd-note') as HTMLElement;
  const btns = bd.querySelector('.m-cmd-btns') as HTMLElement;
  let open = true;
  const m: CommandMenu = {
    root: bd,
    get open() { return open; },
    setTitle(t, s) { h3.textContent = t; small.textContent = s || ''; small.style.display = s ? '' : 'none'; },
    setPanel(html) { panel.innerHTML = html; panel.style.display = html ? '' : 'none'; },
    setNote(html) { note.innerHTML = html; note.style.display = html ? '' : 'none'; },
    setButtons(list, onPick) {
      btns.innerHTML = '';
      list.forEach(b => {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = `m-btn ${b.kind || ''}${b.disabled ? ' is-disabled' : ''}`;
        el.innerHTML = `<span>${b.text}</span>${b.sub ? `<small>${b.sub}</small>` : ''}${b.disabled ? `<small class="why">${b.disabled}</small>` : ''}`;
        if (b.disabled) el.disabled = true;
        el.onclick = (e) => { e.stopPropagation(); onPick(b.id); };
        btns.appendChild(el);
      });
    },
    close() { if (!open) return; open = false; bd.remove(); o.onClose?.(); },
  };
  m.setTitle(o.title, o.sub);
  m.setPanel(o.panel || '');
  m.setNote(o.note || '');
  m.setButtons(o.buttons, o.onPick);
  const x = bd.querySelector('.m-cmd-x') as HTMLButtonElement | null;
  if (x) x.onclick = () => m.close();
  return m;
}

/** 簡單的底部 sheet (手簿、設定…)：點背景關閉 */
export function sheet(title: string, html: string, cls = ''): HTMLElement {
  document.querySelectorAll('.m-sheet').forEach(e => e.remove());
  const bd = document.createElement('div');
  bd.className = `m-sheet open ${cls}`;
  bd.innerHTML = `<div class="m-sheet-box"><div class="m-sheet-head"><b>${title}</b><button type="button" class="m-sheet-x">關閉</button></div><div class="m-sheet-body">${html}</div></div>`;
  bd.addEventListener('click', (e) => { if (e.target === bd) bd.remove(); });
  (bd.querySelector('.m-sheet-x') as HTMLButtonElement).onclick = () => bd.remove();
  document.body.appendChild(bd);
  return bd;
}
export function closeSheet() { document.querySelectorAll('.m-sheet').forEach(e => e.remove()); }
