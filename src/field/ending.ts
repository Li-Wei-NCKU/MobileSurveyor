/**
 * 尾聲：第三天交差之後，三天的人情、學弟、成績收在一起。
 * 遊戲收官在第三天，所以人情真正的回報放在這裡。
 */
import { loadProgress, type Rel3 } from './jobs';

export interface EndingFacts {
  rel: Rel3;
  /** 今天有沒有遇到廟公 */
  metKeeper: boolean;
  asst: string;
  /** 第二天有沒有好好帶學弟 */
  mentor2: number;
  sameAsst: boolean;
  /** 早上嚴肅交代 */
  serious: boolean;
  /** 學弟忘了鐵鎚：'' 沒忘 / 'back' 回去拿了 / 'lost' 回報遺失 */
  hammer: '' | 'back' | 'lost';
  /** 空三合格 */
  aeroOk: boolean;
}

const TITLE = (s: number) => (s >= 90 ? '外業組長' : s >= 75 ? '工程師' : s >= 60 ? '助理工程師' : '工讀生');

export function endingScenes(f: EndingFacts): { who: string; text: string }[] {
  const pr = loadProgress();
  const out: { who: string; text: string }[] = [];
  const met = (pr.uncle || '') !== '' || f.rel.farmer !== '';
  // 阿伯
  if (f.rel.farmer === 'good') out.push({ who: '阿伯', text: '週末，阿伯提了一大袋自己種的高麗菜來公司，在門口喊：「那個少年仔在嗎？」組長把菜分給全公司，順便問你是怎麼跟阿伯混熟的。' });
  else if (f.rel.farmer === 'bad') out.push({ who: '阿伯', text: '阿伯在地方社團發了一篇文：「測量公司的少年仔講話都黑白講」，下面留言一百多則。組長把截圖印出來，貼在器材室的白板上。' });
  else if (met) out.push({ who: '阿伯', text: '阿伯的田下一季種了玉米。田埂上那個黑白的標，他說留著也不錯，下雨天可以看水淹到哪裡。' });
  // 村民、里長
  if (f.rel.village === 'good') out.push({ who: '里長', text: '里民大會上，里長說：「之前來拍地圖的那家公司很客氣，有公文、會解釋，以後村裡要測量就找他們。」' });
  else if (f.rel.village === 'bad') out.push({ who: '里長', text: '里長寄了一封陳情信到公司，標題是〈請貴公司加強外業人員溝通訓練〉。組長把它護貝起來，當新人教材。' });
  else out.push({ who: '村裡', text: '村裡的人很快就忘了你們來過。只有正射影像上，那幾個黑白方塊還留在田埂邊。' });
  // 廟公
  if (f.metKeeper || f.rel.keeper) {
    if (f.rel.keeper === 'good') out.push({ who: '廟公', text: '廟公打電話到公司：「下個月建醮，你們那台會飛的可以來幫我們拍一張大合照嗎？」' });
    else if (f.rel.keeper === 'bad') out.push({ who: '廟公', text: '廟公跟香客說：「那些拍照的少年仔喔，叫他移個車要三催四請。」進香團的阿嬤們都聽到了。' });
  }
  // 學弟
  const n = `學弟${f.asst}`;
  if (f.hammer === 'lost') out.push({ who: n, text: `那支鐵鎚到現在還沒找回來。${n}每次開車經過那塊田，都會多看兩眼。` });
  else if (f.hammer === 'back') out.push({ who: n, text: `${n}在鐵鎚握把上貼了一張紙條：「收工前數一數」。` });
  else if ((f.sameAsst && f.mentor2 >= 1) || f.serious) out.push({ who: n, text: `${n}把這幾天學到的寫在筆記本第一頁：「尺要立在標石頂上。收東西要對清單。」下禮拜，他第一次自己帶工讀生出外業。` });
  else if (f.sameAsst && f.mentor2 <= -1) out.push({ who: n, text: `${n}偷偷問組長，下次能不能跟別的學長出去。` });
  else out.push({ who: n, text: `${n}說他這三天學到最多的是：原來測量有一半的時間在跟人講話。` });
  // 小朋友
  if (pr.kids === 'stopped') out.push({ who: '小朋友', text: '放學的小朋友在作文〈我的志願〉裡寫：「我長大要當測量員，可以飛無人機，還可以叫狗不要過來。」' });
  return out;
}

export function showEnding(f: EndingFacts, onDone: () => void) {
  const pr = loadProgress();
  const sc = pr.scores || {};
  const days = [sc.d1, sc.d2, sc.d3].filter((x): x is number => typeof x === 'number');
  const avg = days.length ? Math.round(days.reduce((a, b) => a + b, 0) / days.length) : 0;
  const scenes = endingScenes(f);
  const good = (['farmer', 'keeper', 'village'] as const).filter(k => f.rel[k] === 'good').length;
  const bad = (['farmer', 'keeper', 'village'] as const).filter(k => f.rel[k] === 'bad').length;
  const boss = avg >= 90 && bad === 0 ? '下個月的案子，派工單由你來寫。'
    : good > bad ? '測量做得怎樣先不說，村裡的人都記得你，這比什麼都難。'
      : bad > good ? '數字可以重測，人情不行。下次出門前，派工單記得帶在身上。'
        : f.aeroOk ? '成果交得出去。下次多跟人家聊兩句，會更順。' : '成果還要再補。不過，大家都是這樣過來的。';
  const box = document.createElement('div');
  box.className = 'paper ending';
  box.innerHTML = `
    <div class="paper-head"><h2>尾聲：三天之後</h2></div>
    <ul class="end-list">${scenes.map(s => `<li><b>${s.who}</b><p>${s.text}</p></li>`).join('')}</ul>
    <div class="end-you">
      <div>${days.length > 1 ? `${days.length} 天平均 <strong>${avg}</strong> 分` : `今天 <strong>${avg}</strong> 分`}　考評：<strong>${TITLE(avg)}</strong></div>
      <p class="hand">組長在你的考核表上寫：「${boss}」</p>
    </div>
    <div class="end-fin">鍵盤測量員　完　·　謝謝你走完這三天外業</div>
    <div class="paper-actions"><button class="btn-paper" id="end-done"><kbd class="cap cap-accent">Enter</kbd> 回主選單</button></div>`;
  const bd = document.createElement('div');
  bd.className = 'modal-backdrop show field-modal';
  bd.id = 'field-ending';
  bd.appendChild(box);
  document.body.appendChild(bd);
  if (document.exitPointerLock) document.exitPointerLock();
  const done = () => { window.removeEventListener('keydown', onKey, true); bd.remove(); onDone(); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter') { e.stopPropagation(); done(); } };
  window.addEventListener('keydown', onKey, true);
  (box.querySelector('#end-done') as HTMLButtonElement).onclick = done;
}
