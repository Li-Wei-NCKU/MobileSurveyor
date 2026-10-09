/**
 * 因果紀錄：這一天「你做了什麼 → 結果怎樣」，以及沒走的那條路「如果當時……」。
 * 成果報告書最後會列出來，讓第一次玩就看得到連鎖。
 */
export interface StoryLine { cause: string; effect: string }

let chain: StoryLine[] = [];
let alts: string[] = [];

export function resetStory() { chain = []; alts = []; }

/** 你做了 cause → 造成 effect */
export function tell(cause: string, effect: string) {
  if (chain.some(c => c.cause === cause && c.effect === effect)) return;
  chain.push({ cause, effect });
}

/** 沒選的那條路 */
export function whatIf(text: string) {
  if (!alts.includes(text)) alts.push(text);
}

export function getStory() { return { chain: chain.slice(), alts: alts.slice() }; }

/** 存讀檔用 */
export function storySnapshot() { return { chain, alts }; }
export function storyRestore(s: { chain?: StoryLine[]; alts?: string[] } | null | undefined) {
  chain = s?.chain ? s.chain.slice() : [];
  alts = s?.alts ? s.alts.slice() : [];
}
