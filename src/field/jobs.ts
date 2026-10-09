/**
 * 派工 (每天的工作內容) 與進度存檔
 *  - day1 gnss：一等衛星控制點 CKSV 靜態觀測
 *  - day2 level：縣道路肩一等水準 BM-1035 → BM-1036
 *  - day3 gcp：農地航測控制點佈設 (+ 當天航拍，下一版)
 */
import type { ItemId } from './items';

export type JobId = 'gnss' | 'level' | 'gcp';

export interface JobDef {
  id: JobId;
  day: number;
  title: string;
  menuName: string;
  menuDesc: string;
  tasks: string[];
  required: ItemId[];
  /** 現場中心 (判斷設備是否留在現場、是否抵達) */
  site: { x: number; z: number; r: number };
  /** 建議停車位置 */
  park: { x: number; z: number };
  route: 'toSite' | 'toLevel' | 'toGcp';
  back: 'return' | 'levelReturn' | 'gcpReturn';
  workOrder: { item: string; place: string; spec: string; note: string; seq: string; gear: string };
  hints: { prep: string; toSite: string; site: string; observe: string; packup: string };
}

/** 縣道東段路肩水準路線 (路面北側路肩 z≈52.4) */
export const LEVEL_ROUTE = {
  bm1: { x: 60, z: 52.6, name: 'BM-1035' },
  bm2: { x: 118, z: 52.6, name: 'BM-1036' },
};

export const JOBS: Record<JobId, JobDef> = {
  gnss: {
    id: 'gnss', day: 1,
    title: '外業一日：CKSV 靜態觀測',
    menuName: '第一天：GNSS 靜態觀測',
    menuDesc: '一等衛星控制點 CKSV。自己備料裝車、開車到現場、定心定平、量天線高、記錄一個時段。',
    tasks: ['讀派工單', '備料裝車：把需要的設備搬上後斗', '開車前往 CKSV 控制點', '卸貨並架設 GNSS（三腳架 → 基座 → 接收儀）', '完成靜態觀測', '收工：設備全部裝回車上', '開回公司交差'],
    required: ['tripod', 'tribrach', 'gnss', 'toolbag'],
    site: { x: 0, z: 0, r: 80 },
    park: { x: -9.5, z: 12 },
    route: 'toSite', back: 'return',
    workOrder: {
      seq: '01',
      item: '一等衛星控制點 CKSV　GNSS 靜態觀測（一時段）',
      place: '出公司右轉沿縣道往東約 140 公尺，產業道路左側農地；路旁有黃色指示箭頭。',
      spec: '定心 ≤ 1 mm、整平氣泡居中、天線高量至 mm',
      gear: '三腳架、基座箱、GNSS 接收儀箱、外業工具袋（手簿、捲尺）',
      note: '昨天航拍組車子沒卸，後斗自己處理。<br>用不到的東西不要亂帶，佔位子。<br>腳架不要再忘在田裡了。',
    },
    hints: {
      prep: '貨架上挑設備，拿到車尾按 E 放進後斗。後斗還有昨天的東西，要不要先搬下來自己決定。準備好就上車（看著車頭按 E）。',
      toSite: '出公司右轉沿縣道往東，看到黃色箭頭左轉進產業道路，停在路邊空地，不要停在路中間。',
      site: '把設備從後斗搬到 CKSV 控制點：先拿三腳架對著控制點按 E，再依序裝上基座和接收儀。',
      observe: '依手簿步驟完成定心定平、量天線高、啟動觀測。',
      packup: '觀測完成！儀器已拆收在控制點旁，全部搬回後斗再走。腳架不要再忘了。',
    },
  },
  level: {
    id: 'level', day: 2,
    title: '外業第二天：縣道一等水準',
    menuName: '第二天：一等水準測量',
    menuDesc: '縣道路肩 BM-1035 → BM-1036。帶學弟扶尺，2～3 站加尺墊轉點，讀尺、記手簿、算閉合差。',
    tasks: ['讀派工單', '備料裝車：把需要的設備搬上後斗', '開車到縣道東段，停在路肩', '把標尺、尺墊交給學弟，到 BM-1035 立尺', '水準觀測：架站、定平、讀後視與前視，轉點到 BM-1036', '收工：設備全部裝回車上', '開回公司交差'],
    required: ['tripod', 'level', 'staff', 'plate', 'toolbag', 'cones'],
    site: { x: 89, z: 52.5, r: 70 },
    park: { x: 50, z: 52.4 },
    route: 'toLevel', back: 'levelReturn',
    workOrder: {
      seq: '02',
      item: '縣道路肩一等水準 BM-1035 → BM-1036（單程，含轉點）',
      place: '出公司右轉沿縣道往東，過產業道路口繼續直行約 60 公尺，停在右側路肩。兩個水準點都在路肩上。',
      spec: '前後視距差 ≤ 2 m、讀數估讀至 mm、閉合差 ≤ 3 mm（本公司內規）',
      gear: '三腳架、自動水準儀箱、水準尺、尺墊、外業工具袋、交通錐',
      get note() { return `今天學弟${asstName()}跟你出去，標尺和尺墊交給他扶。<br>路肩作業記得擺交通錐，車很多，警察也常經過。<br>昨天那個阿伯如果又出現……你自己看著辦。`; },
    },
    hints: {
      get prep() { return `今天測水準：貨架上挑設備搬上後斗（學弟${asstName()}會跟著上車）。準備好就上車。`; },
      toSite: '出公司右轉沿縣道往東，過產業道路口繼續直行，停在右側路肩。',
      get site() { return `把標尺和尺墊從後斗拿出來交給學弟${asstName()}（對著他按 E），他就會去 BM-1035 立尺。`; },
      observe: '扛腳架找一個前後視距差不多的位置架站。',
      get packup() { return `水準測完了！把儀器、腳架收回後斗，標尺和尺墊跟學弟${asstName()}拿回來，一起帶走。`; },
    },
  },
  gcp: {
    id: 'gcp', day: 3,
    title: '外業第三天：航測控制點佈設',
    menuName: '第三天：航測控制點佈設',
    menuDesc: '公司西邊的農地。自己看範圍選 4～5 個點，鋪模板、噴黑白漆、敲鋼釘。選在哪裡，航拍的時候就知道了。',
    tasks: ['讀派工單', '備料裝車：把需要的設備搬上後斗', '開車到農地，停在農路口空地', '去車尾拿噴漆箱（學弟拿模板、鐵鎚、RTK），用平板（Q）看範圍', '佈設 4～5 個控制點：鋪模板 → 噴白 → 噴黑 → 敲鋼釘 → RTK 測坐標 → 拍點位照片', '下午航拍：架起降點 → 畫航線 → 起飛 → 自動航線 → 降落', '收工：設備全部裝回車上', '開回公司，用電腦匯入照片、跑空三，交差'],
    required: ['template', 'paint', 'hammer', 'rtk', 'drone', 'toolbag'],
    site: { x: -251, z: 12, r: 70 },
    park: { x: -261.6, z: 40.8 },
    route: 'toGcp', back: 'gcpReturn',
    workOrder: {
      seq: '03',
      item: '農地航測控制點（GCP）佈設 5 點　＋　當日 UAV 航拍',
      place: '出公司左轉沿縣道往西約 100 公尺，右手邊看到「福德祠」黃色指示牌就右轉進水泥農路，車停路口旁的空地。',
      spec: '對空標誌 1.2 m 黑白方格、中心鋼釘；範圍四角＋中央各一點（至少 4 點）；RTK 固定解；航高 60 m',
      gear: '噴漆箱、航測標模板、鐵鎚鋼釘、RTK 移動站、外業工具袋；無人機（已在後斗）',
      get note() { return `學弟${asstName()}今天跟你，到了現場噴漆你拿，其他的他會拿。範圍圖在平板上（Q）。<br>標噴好看一點，上次被業主退件。`; },
    },
    hints: {
      get prep() { return `今天佈標：貨架上挑設備搬上後斗（也可以叫學弟${asstName()}幫忙搬）。準備好就上車。`; },
      toSite: '出公司左轉沿縣道往西，看到「福德祠」指示牌右轉進農路，停在路口旁的空地。',
      get site() { return `模板、鐵鎚、RTK 學弟${asstName()}會從後斗拿，你去車尾拿噴漆箱。Q 看平板，選好點看著地面按 E。`; },
      observe: '繼續佈標。',
      get packup() { return `佈標完成！東西全部裝回後斗（學弟${asstName()}會幫忙拿），再開回公司。`; },
    },
  },
};

// ------------------------------------------------------------------
// 第二天的學弟：每次隨機一位
// ------------------------------------------------------------------
export const ASST_NAMES = ['敬翔', '李暐', '宏斌', '育維', '品旭'];
let asst = ASST_NAMES[Math.floor(Math.random() * ASST_NAMES.length)];
export function asstName() { return asst; }
export function setAsstName(n: string) { if (n) asst = n; }
export function pickAsstName() { asst = ASST_NAMES[Math.floor(Math.random() * ASST_NAMES.length)]; return asst; }

// ------------------------------------------------------------------
// 進度存檔 (瀏覽器 localStorage；失敗就當沒存)
// ------------------------------------------------------------------
export interface Progress {
  day1Done: boolean;
  day2Done: boolean;
  day3Done: boolean;
  /** 第一天跟阿伯說了什麼 ('' = 沒遇到) */
  uncle: string;
  /** 第一天阿黃的結果 */
  dog: '' | 'stopped' | 'bumped';
  kids: '' | 'stopped' | 'bumped';
  /** 第三天留下的人情 (下次再來、之後的關卡會記得) */
  rel3?: Rel3;
  /** 第一天：地主／里長那段怎麼應對；對方是不是里長 */
  owner1?: '' | 'doc' | 'talk' | 'sorry' | 'argue';
  owner1Chief?: boolean;
  /** 第一天：阿姨問地界 (ok / no / proper / guess / move-sorry / move-blame) */
  auntie1?: string;
  /** 第一天：組長來電 */
  boss1?: string;
  /** 第二天：阿伯回訪時 (a = 道歉／說實話／好好聊, b = 沒有) */
  uncle2?: '' | 'a' | 'b';
  /** 第二天：有沒有好好帶學弟 (正 = 有) */
  mentor2?: number;
  /** 第二天的學弟 (第三天同一個人) */
  asst2?: string;
  /** 每天的總分 */
  scores?: { d1?: number; d2?: number; d3?: number };
}

/**
 * 第一次玩到第三天 (還沒有第三天的存檔人情)：用前兩天的結果決定大家對你的印象。
 *  - 阿伯 = 第一天問「是不是要徵收」的那位，第三天的田就是他的
 *  - 村民 (里長、鄰居)：第一天頂撞、亂動界樁推給阿姨 → 不信任；拿公文、教阿姨申請鑑界 → 信任
 */
export function relFromDays(p: Progress): Rel3 {
  const r: Rel3 = { farmer: '', keeper: '', village: '' };
  if (p.uncle === 'explain' || p.uncle === 'order') r.farmer = 'good';
  else if (p.uncle === 'lie' || p.uncle === 'secret' || p.uncle === 'ignore') r.farmer = p.uncle2 === 'a' ? '' : 'bad';
  const bad = p.owner1 === 'argue' || p.auntie1 === 'move-blame' || (p.uncle === 'lie' && p.uncle2 !== 'a') || p.boss1 === 'blame';
  const good = p.owner1 === 'doc' || p.auntie1 === 'ok' || p.auntie1 === 'proper';
  r.village = bad ? 'bad' : good ? 'good' : '';
  return r;
}
export type RelV = '' | 'good' | 'bad';
export interface Rel3 { farmer: RelV; keeper: RelV; village: RelV }
const KEY = 'ks-progress-v2';
const EMPTY: Progress = { day1Done: false, day2Done: false, day3Done: false, uncle: '', dog: '', kids: '' };

export function loadProgress(): Progress {
  try {
    const s = localStorage.getItem(KEY);
    return s ? { ...EMPTY, ...JSON.parse(s) } : { ...EMPTY };
  } catch { return { ...EMPTY }; }
}

export function saveProgress(p: Partial<Progress>) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...loadProgress(), ...p })); } catch { /* 無痕模式等情況存不了 */ }
}
