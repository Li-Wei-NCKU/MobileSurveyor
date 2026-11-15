/**
 * 「手機要怎麼拿」的說明圖 (扶尺：手機立直；RTK：手機放平)。
 * 左邊 ✓ 對的拿法 (氣泡在圈裡輕輕飄)，右邊 ✕ 歪掉的樣子 (氣泡跑出圈外)。
 */

const SKIN = '#e3b08a', SKIN_D = '#c98f68', INK = '#1f2d3d', OK = '#15803d', BAD = '#b42318';

/** 手機螢幕上的圓水準器 (cx, cy 中心；rx, ry 讓放平的手機可以畫成橢圓) */
function vial(cx: number, cy: number, rx: number, ry: number, bx: number, by: number, anim: boolean) {
  const drift = anim
    ? `<animateTransform attributeName="transform" type="translate" values="0 0; ${rx * 0.22} ${-ry * 0.12}; ${-rx * 0.16} ${ry * 0.18}; 0 0" dur="3.2s" repeatCount="indefinite"/>`
    : '';
  return `
    <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#dff3e8" stroke="#94a3b8" stroke-width="1.2"/>
    <ellipse cx="${cx}" cy="${cy}" rx="${rx * 0.42}" ry="${ry * 0.42}" fill="none" stroke="${OK}" stroke-width="1.6"/>
    <g><ellipse cx="${cx + bx}" cy="${cy + by}" rx="${rx * 0.27}" ry="${ry * 0.27}" fill="#bef264" stroke="#4d7c0f" stroke-width="1.1"/>${drift}</g>`;
}

/**
 * 立起來的手機＋握著它的手。螢幕像 AR：上面是遊戲世界 (天空、地面、遠處的水準儀)，
 * 下面是斜斜往下看的圓水準器 (cx 手機中心 x、cy 中心 y、ang 傾斜角度、bubX 氣泡偏移)
 */
function uprightPhone(cx: number, cy: number, ang: number, bubX: number, anim: boolean) {
  const w = 36, h = 66;
  const sx = cx - w / 2 + 3, sy = cy - h / 2 + 5, sw = w - 6, sh = h - 10;
  const hor = sy + sh * 0.46;              // 地平線
  return `<g transform="rotate(${ang} ${cx} ${cy + 30})">
    <path d="M${cx - 20} ${cy + 48} q-4 -26 6 -34 l28 0 q10 8 6 34 q-2 14 -20 16 q-18 -2 -20 -16z" fill="${SKIN}"/>
    <rect x="${cx - w / 2}" y="${cy - h / 2}" width="${w}" height="${h}" rx="6" fill="${INK}"/>
    <rect x="${sx}" y="${sy}" width="${sw}" height="${hor - sy}" fill="#bfe3f7"/>
    <rect x="${sx}" y="${hor}" width="${sw}" height="${sy + sh - hor}" fill="#9ccf6a"/>
    <!-- 遠處的水準儀 (三腳架) -->
    <path d="M${cx - 6} ${hor - 7} l-3 9 M${cx - 6} ${hor - 7} l3 9 M${cx - 6} ${hor - 7} l0 9" stroke="#475569" stroke-width="1"/>
    <rect x="${cx - 8.5}" y="${hor - 10}" width="5" height="3" rx="1" fill="#1f7ab8"/>
    <!-- 眼前的標尺 (立在畫面中間偏右) -->
    <rect x="${cx + 3}" y="${sy}" width="7" height="${sh}" fill="#f8fafc" stroke="#cbd5e1" stroke-width="0.6"/>
    ${[0, 1, 2, 3, 4, 5, 6].map(i => `<rect x="${cx + 4.2}" y="${sy + 2 + i * 7.6}" width="4.6" height="${i % 2 ? 2 : 3.6}" fill="${i % 3 === 0 ? '#c81e1e' : '#111'}"/>`).join('')}
    <!-- 斜斜往下看的圓水準器 -->
    <ellipse cx="${cx}" cy="${sy + sh - 11}" rx="12.5" ry="6.4" fill="#1d2025"/>
    ${vial(cx, sy + sh - 11.5, 11, 5.4, bubX, 0, anim)}
    <path d="M${cx - 19} ${cy + 24} q-6 -10 -2 -20 q4 -4 7 1 l1 19z" fill="${SKIN_D}"/>
    ${[0, 1, 2].map(i => `<rect x="${cx + w / 2 - 3}" y="${cy + 6 + i * 9}" width="9" height="7.5" rx="3.6" fill="${SKIN_D}"/>`).join('')}
  </g>`;
}

/** 平放在手掌上的手機 (透視：上面窄下面寬)。tilt = 往右邊翹起的程度 */
function flatPhone(cx: number, cy: number, tilt: number, bubX: number, anim: boolean) {
  const tw = 38, bw = 50, h = 34;         // 上緣寬、下緣寬、看起來的深度
  const lift = tilt * 10;                  // 右邊翹起來
  const p = [
    [cx - tw / 2, cy - h / 2], [cx + tw / 2, cy - h / 2 - lift],
    [cx + bw / 2, cy + h / 2 - lift], [cx - bw / 2, cy + h / 2],
  ];
  const pts = p.map(q => q.join(',')).join(' ');
  const side = tilt > 0
    ? `<polygon points="${p[2].join(',')} ${p[1].join(',')} ${p[1][0]},${p[1][1] + 5} ${p[2][0]},${p[2][1] + 6}" fill="#0f172a"/>`
    : `<polygon points="${p[3].join(',')} ${p[2].join(',')} ${p[2][0]},${p[2][1] + 5} ${p[3][0]},${p[3][1] + 5}" fill="#0f172a"/>`;
  return `
    <!-- 手掌托在下面 -->
    <ellipse cx="${cx}" cy="${cy + h / 2 + 6}" rx="40" ry="13" fill="${SKIN}"/>
    <path d="M${cx + 30} ${cy + h / 2 + 2} q14 -4 18 6 q-6 6 -18 4z" fill="${SKIN_D}"/>
    ${side}
    <polygon points="${pts}" fill="${INK}"/>
    <polygon points="${p.map((q, i) => [q[0] + (i === 0 || i === 3 ? 3.5 : -3.5), q[1] + (i < 2 ? 3 : -3)].join(',')).join(' ')}" fill="#f8fafc"/>
    ${vial(cx + 1, cy - lift / 2, 13, 8, bubX, 0, anim)}`;
}

const label = (x: number, y: number, ok: boolean, t: string) =>
  `<text x="${x}" y="${y}" text-anchor="middle" font-size="12.5" font-weight="800" fill="${ok ? OK : BAD}">${ok ? '✓' : '✕'} ${t}</text>`;

/** 扶尺：手機立直，像扶標尺一樣 */
export const staffPoseArt = `<svg viewBox="0 0 300 150" width="100%" aria-hidden="true">
  <rect x="2" y="2" width="146" height="146" rx="12" fill="#ecfdf3" stroke="#86efac"/>
  <rect x="152" y="2" width="146" height="146" rx="12" fill="#fef2f2" stroke="#fca5a5"/>
  <!-- 背景的標尺：手機就像這根尺 -->
  <rect x="22" y="14" width="10" height="104" rx="2" fill="#fff" stroke="#cbd5e1"/>
  ${[0, 1, 2, 3, 4, 5].map(i => `<rect x="24" y="${18 + i * 17}" width="6" height="8" fill="${i % 2 ? '#111' : '#c81e1e'}"/>`).join('')}
  ${uprightPhone(82, 62, 0, 0, true)}
  <!-- 微微左右修正 -->
  <path d="M60 22 q22 -12 44 0" fill="none" stroke="${OK}" stroke-width="2" stroke-linecap="round"/>
  <path d="M60 22 l2 -6 M60 22 l6 1 M104 22 l-2 -6 M104 22 l-6 1" stroke="${OK}" stroke-width="2" stroke-linecap="round"/>
  ${label(75, 140, true, '立直，像扶著標尺')}
  ${uprightPhone(226, 64, 20, 9, false)}
  <line x1="226" y1="10" x2="226" y2="124" stroke="#94a3b8" stroke-dasharray="3 3"/>
  ${label(225, 140, false, '歪了，氣泡跑掉')}
</svg>`;

/** RTK：手機放平，螢幕朝上，像桿頂的圓水準器 */
export const rtkPoseArt = `<svg viewBox="0 0 300 150" width="100%" aria-hidden="true">
  <rect x="2" y="2" width="146" height="146" rx="12" fill="#ecfdf3" stroke="#86efac"/>
  <rect x="152" y="2" width="146" height="146" rx="12" fill="#fef2f2" stroke="#fca5a5"/>
  <!-- 對中桿：桿頂的圓水準器就是手機 -->
  <rect x="18" y="26" width="5" height="96" rx="2" fill="#f2b705"/>
  <ellipse cx="20.5" cy="24" rx="10" ry="5" fill="#64748b"/>
  <ellipse cx="20.5" cy="23" rx="4" ry="2" fill="#bef264" stroke="#4d7c0f" stroke-width="0.8"/>
  ${flatPhone(86, 70, 0, 0, true)}
  <!-- 螢幕朝上 -->
  <path d="M86 30 v-14 M80 22 l6 -7 6 7" fill="none" stroke="${OK}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  ${label(75, 140, true, '放平、螢幕朝上')}
  ${flatPhone(226, 74, 1, 8, false)}
  ${label(225, 140, false, '斜了，氣泡跑掉')}
</svg>`;

/**
 * 玩的時候手機拿錯姿勢 (立直／放平差太多) 超過一下子，就在畫面上跳出這張圖提醒；拿對了就收起來。
 * 回傳每一幀呼叫的 update(bad, dt)
 */
export function posePop(parent: HTMLElement, art: string, text: string): (bad: boolean, dt: number) => void {
  // 掛在 body 上 (不掛在小遊戲卡片裡，卡片有 transform，fixed 定位會跑掉)；卡片關掉就跟著收掉
  const el = document.createElement('div');
  el.className = 'pose-pop';
  el.innerHTML = `<div class="pose-pop-art">${art}</div><p>${text}</p>`;
  document.body.appendChild(el);
  const mo = new MutationObserver(() => { if (!parent.isConnected || parent.classList.contains('leave')) { el.remove(); mo.disconnect(); } });
  mo.observe(document.body, { childList: true });
  mo.observe(parent, { attributes: true, attributeFilter: ['class'] });
  let badT = 0, goodT = 0, on = false;
  return (bad: boolean, dt: number) => {
    if (bad) { badT += dt; goodT = 0; } else { goodT += dt; badT = 0; }
    if (!on && badT > 1.2) { on = true; el.classList.add('show'); }
    if (on && goodT > 0.5) { on = false; el.classList.remove('show'); }
  };
}
