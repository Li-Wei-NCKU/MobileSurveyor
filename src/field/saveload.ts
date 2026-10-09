/**
 * 存檔 / 讀檔：F6 存成文字檔 (JSON)，F7 選檔讀回。主選單也可以讀檔。
 * 檔案內容是目前這一刻的所有參數 (玩家位置、手上的東西、後斗、地上的設備、
 * 儀器步驟、路人狀態、手簿……)，可以用記事本打開看。
 */
import type { GameApp, AnyObj } from './legacy';
import type { FieldDay } from './fieldDay';
import { loadProgress, saveProgress } from './jobs';
import { cineActive } from './cine';
import * as ui from './ui';

const FORMAT = 'keyboard-surveyor-save';
const VERSION = 1;

export function installSaveLoad(app: GameApp, field: FieldDay) {
  window.addEventListener('keydown', (e) => {
    if (e.code === 'F6') { e.preventDefault(); e.stopPropagation(); saveGame(app, field); }
    if (e.code === 'F7') { e.preventDefault(); e.stopPropagation(); loadGame(field); }
  }, true);
  document.getElementById('btn-save')?.addEventListener('click', () => saveGame(app, field));
  document.getElementById('btn-load')?.addEventListener('click', () => loadGame(field));
  window.addEventListener('ks-load', () => loadGame(field));
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

export function saveGame(app: GameApp, field: FieldDay) {
  if (app.currentLevelObj !== field || ['brief', 'done'].includes(field.phase)) { ui.toast('開始一天的工作之後才能存檔。', 'warn'); return; }
  if (cineActive()) { ui.toast('等這段過場結束再存檔。', 'warn'); return; }
  let state: AnyObj;
  try { state = field.snapshot(); } catch (err) { console.error(err); ui.toast('存檔失敗。', 'bad'); return; }
  const day = field.job === 'gnss' ? 1 : field.job === 'level' ? 2 : 3;
  const data = {
    format: FORMAT,
    version: VERSION,
    說明: '鍵盤測量員存檔。按 F7（或主選單的「讀取存檔」）選這個檔案即可接關。內容可以用記事本看，但改壞了可能讀不回來。',
    savedAt: new Date().toISOString(),
    day,
    progress: loadProgress(),
    state,
  };
  const text = JSON.stringify(data, null, 2);
  const name = `鍵盤測量員存檔_第${day}天_${stamp()}.txt`;
  if (document.exitPointerLock) document.exitPointerLock();
  const w = window as AnyObj;
  // Chrome / Edge：系統的「另存新檔」視窗，可以自己選位置
  if (typeof w.showSaveFilePicker === 'function') {
    w.showSaveFilePicker({ suggestedName: name, types: [{ description: '鍵盤測量員存檔', accept: { 'text/plain': ['.txt'] } }] })
      .then(async (h: AnyObj) => { const ws = await h.createWritable(); await ws.write(text); await ws.close(); ui.toast(`已存檔：${h.name}`, 'good', 3500); })
      .catch((err: AnyObj) => { if (err?.name === 'AbortError') ui.toast('取消存檔。', 'info'); else download(text, day); });
    return;
  }
  download(text, day);
}

/** 一般下載 (檔名用英文，避免某些系統把中文檔名吃掉) */
function download(text: string, day: number) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `KeyboardSurveyor_save_day${day}_${stamp()}.txt`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  ui.toast(`已存檔（下載）：${a.download}`, 'good', 3500);
}

export function loadGame(field: FieldDay) {
  if (document.exitPointerLock) document.exitPointerLock();
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.txt,.json,text/plain,application/json';
  inp.onchange = () => {
    const f = inp.files?.[0];
    if (!f) return;
    f.text().then(txt => {
      let data: AnyObj;
      try { data = JSON.parse(txt); } catch { ui.toast('這個檔案不是鍵盤測量員的存檔。', 'bad'); return; }
      if (data?.format !== FORMAT || !data.state) { ui.toast('這個檔案不是鍵盤測量員的存檔。', 'bad'); return; }
      try {
        if (data.progress) saveProgress(data.progress);
        field.restore(data.state);
        ui.toast(`讀檔完成：第${data.day}天（${new Date(data.savedAt).toLocaleString()}）`, 'good', 3500);
      } catch (err) {
        console.error(err);
        ui.toast('讀檔失敗：存檔內容有問題。', 'bad', 4000);
      }
    });
  };
  inp.click();
}
