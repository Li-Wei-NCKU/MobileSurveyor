/**
 * 瀏覽器內快速存檔 (3 格)：手機上下載檔案不方便，所以把同一份 snapshot 存在 localStorage。
 * 檔案存檔 / 讀檔 (saveload.ts) 照舊保留在選單裡。
 */
import type { GameApp, AnyObj } from '../field/legacy';
import type { FieldDay } from '../field/fieldDay';
import { loadProgress, saveProgress } from '../field/jobs';
import { cineActive } from '../field/cine';
import { saveGame, loadGame } from '../field/saveload';
import * as ui from '../field/ui';
import { sheet, closeSheet } from './sheet';

const KEY = (i: number) => `ks-mobile-slot-${i}`;

interface Slot { savedAt: string; day: number; phase: string; progress: AnyObj; state: AnyObj }

function read(i: number): Slot | null {
  try { const s = localStorage.getItem(KEY(i)); return s ? JSON.parse(s) : null; } catch { return null; }
}

export function quickSave(app: GameApp, field: FieldDay, i: number): boolean {
  if (app.currentLevelObj !== field || ['brief', 'done'].includes(field.phase)) { ui.toast('開始一天的工作之後才能存檔。', 'warn'); return false; }
  if (cineActive()) { ui.toast('等這段過場結束再存檔。', 'warn'); return false; }
  let state: AnyObj;
  try { state = field.snapshot(); } catch (err) { console.error(err); ui.toast('存檔失敗。', 'bad'); return false; }
  const day = field.job === 'gnss' ? 1 : field.job === 'level' ? 2 : 3;
  const slot: Slot = { savedAt: new Date().toISOString(), day, phase: field.phase, progress: loadProgress(), state };
  try { localStorage.setItem(KEY(i), JSON.stringify(slot)); } catch { ui.toast('存檔失敗：瀏覽器空間不夠。', 'bad'); return false; }
  ui.toast(`已存到第 ${i + 1} 格。`, 'good', 2200);
  return true;
}

export function quickLoad(field: FieldDay, i: number): boolean {
  const s = read(i);
  if (!s) { ui.toast('這一格是空的。', 'warn'); return false; }
  try {
    if (s.progress) saveProgress(s.progress);
    field.restore(s.state);
    ui.toast(`讀檔完成：第 ${s.day} 天`, 'good', 3000);
    return true;
  } catch (err) { console.error(err); ui.toast('讀檔失敗：存檔內容有問題。', 'bad', 4000); return false; }
}

const PHASE: Record<string, string> = { prep: '整備儀器', toSite: '前往現場', site: '現場', observe: '施測中', packup: '收工', return: '回程' };

export function quickSaveMenu(app: GameApp, field: FieldDay, loadOnly = false) {
  const rows = [0, 1, 2].map(i => {
    const s = read(i);
    const info = s ? `第 ${s.day} 天 · ${PHASE[s.phase] || s.phase} · ${new Date(s.savedAt).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : '（空）';
    return `<div class="m-slot"><div class="m-slot-info"><b>第 ${i + 1} 格</b><span>${info}</span></div><div class="m-slot-btns">${loadOnly ? '' : `<button type="button" data-s="${i}">存檔</button>`}<button type="button" data-l="${i}"${s ? '' : ' disabled'}>讀取</button></div></div>`;
  }).join('');
  const bd = sheet('存檔 / 讀檔', `${rows}<div class="m-slot-file"><button type="button" data-f="save"${loadOnly ? ' disabled' : ''}>存成檔案</button><button type="button" data-f="load">從檔案讀取</button></div>`, 'm-saves');
  bd.querySelectorAll<HTMLButtonElement>('[data-s]').forEach(b => b.onclick = () => { if (quickSave(app, field, Number(b.dataset.s))) closeSheet(); });
  bd.querySelectorAll<HTMLButtonElement>('[data-l]').forEach(b => b.onclick = () => { closeSheet(); quickLoad(field, Number(b.dataset.l)); });
  bd.querySelectorAll<HTMLButtonElement>('[data-f]').forEach(b => b.onclick = () => { closeSheet(); if (b.dataset.f === 'save') saveGame(app, field); else loadGame(field); });
}
