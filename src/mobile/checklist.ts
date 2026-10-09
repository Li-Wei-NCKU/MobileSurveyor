/**
 * 備料／收工清點清單：畫成格紋筆記本上手寫的那種便條。
 * 一開始進器材室會自動翻開一次，之後隨時可以從右上角的手簿再看。
 */
import type { AnyObj } from '../field/legacy';
import type { FieldDay } from '../field/fieldDay';
import { sheet } from './sheet';

const esc = (s: string) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));

/** 現在這個階段要不要給清單 */
export function noteApplies(field: FieldDay) {
  return ['prep', 'toSite', 'site', 'observe', 'packup', 'return'].includes(field.phase);
}

/** 筆記本內容 (HTML) */
export function noteHtml(field: FieldDay): string {
  const fd = field as AnyObj;
  const packing = ['prep', 'toSite'].includes(field.phase);
  const list = (fd.packList?.() || []) as { item: string; name: string; loaded: boolean; inHand: boolean }[];
  const extra = (fd.extraInTrunk?.() || []) as string[];
  const title = packing ? '今天要帶的' : '收工清點';
  const sub = esc(String(fd.J?.title || ''));
  const rows = list.map(r => {
    const done = r.loaded;
    return `<li class="${done ? 'done' : ''}"><i>${done ? '✔' : ''}</i><span>${esc(r.name)}</span>${r.inHand && !done ? '<em>手上</em>' : ''}</li>`;
  }).join('');
  const left = list.filter(r => !r.loaded).length;
  const memo = packing
    ? `${extra.length ? `※ 後斗還有昨天沒卸的：${esc(extra.join('、'))}。要不要搬下來自己決定。<br>` : ''}※ 渴了就去點那箱礦泉水，喝一瓶。`
    : '※ 全部搬回後斗才算收工，腳架不要忘了。';
  return `<div class="m-note">
    <div class="m-note-head"><b>${title}</b><span>${sub}</span></div>
    <ul class="m-note-list">${rows}</ul>
    <div class="m-note-sum">${left ? `還差 ${left} 件` : '都齊了 ✔'}</div>
    <p class="m-note-memo">${memo}</p>
  </div>`;
}

/** 翻開清單 */
export function openNote(field: FieldDay) {
  sheet('外業手簿', noteHtml(field), 'm-note-sheet');
}
