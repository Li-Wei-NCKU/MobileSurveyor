/**
 * 車上收音機：播放網路上的台灣電台直播
 *  - 固定頻道：警廣（官方串流 stream.pbs.gov.tw）
 *  - 好事聯播網與其他熱門台：遊戲執行時向 radio-browser.info 公開電台目錄查詢最新串流網址
 *    （電台網址常變動，即時查詢比寫死可靠）
 * HLS (m3u8) 優先用瀏覽器原生播放，不支援時改用 hls.js。
 */
import Hls from 'hls.js';
import { audio as legacyAudio } from './legacy';

export interface Station { name: string; url: string; note?: string; key?: string; custom?: boolean }

const PINNED: Station[] = [
  { name: '警廣 全國交通網', url: 'https://stream.pbs.gov.tw/live/mp3:PBS/playlist.m3u8', note: '路況報導' },
  { name: '警廣 臺北台', url: 'https://stream.pbs.gov.tw/live/TPS/playlist.m3u8' },
  { name: '警廣 臺中台', url: 'https://stream.pbs.gov.tw/live/TCS/playlist.m3u8' },
  { name: '警廣 高雄台', url: 'https://stream.pbs.gov.tw/live/KSS/playlist.m3u8' },
];

const DIRECTORY_MIRRORS = [
  'https://de1.api.radio-browser.info',
  'https://fi1.api.radio-browser.info',
  'https://de2.api.radio-browser.info',
];

interface DirEntry { name: string; url_resolved: string; lastcheckok: number; codec: string }

async function queryDirectory(path: string): Promise<DirEntry[]> {
  for (const base of DIRECTORY_MIRRORS) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 5000);
      const r = await fetch(base + path, { signal: ctl.signal });
      clearTimeout(t);
      if (r.ok) return (await r.json()) as DirEntry[];
    } catch { /* 換下一個鏡像 */ }
  }
  return [];
}

function tidyName(n: string): string {
  return n.replace(/\s+/g, ' ').replace(/^(FM|AM)\s?/i, '').trim().slice(0, 22);
}

export type RadioStatus = 'off' | 'loading' | 'playing' | 'error';

export class CarRadio {
  /** 9 號鍵固定是飛碟電台 (目錄查到之前先放佔位，查不到就只有雜音) */
  stations: Station[] = CarRadio.numbered([PINNED[0], { name: '好事港都', url: '', note: '好事聯播網 高雄 FM98.9' }, ...PINNED.slice(1)], { name: '飛碟電台', url: '', note: '飛碟聯播網' });
  index = 0;
  status: RadioStatus = 'off';
  /** 收訊不良的具體原因 (顯示在面板上，也會寫到 console) */
  reason = '';
  directoryOk: boolean | null = null;
  private el: HTMLAudioElement;
  private hls: Hls | null = null;
  private loadedDirectory = false;
  private wantOn = false;
  onChange: () => void = () => {};

  constructor() {
    this.el = document.createElement('audio');
    this.el.preload = 'none';
    this.el.volume = 0.5625; // 0.75 再調低 25%
    this.el.addEventListener('playing', () => this.set('playing'));
    this.el.addEventListener('error', () => {
      if (!this.el.getAttribute('src')) return;
      const code = this.el.error ? this.el.error.code : 0;
      this.fail(code === 4 ? '瀏覽器無法播放這個串流格式' : code === 2 ? '網路中斷，連不到電台伺服器' : '電台串流無法開啟');
    });
    document.body.appendChild(this.el);
  }

  get current(): Station { return this.stations[this.index]; }
  get isOn(): boolean { return this.wantOn; }

  private set(s: RadioStatus) {
    this.status = s;
    // 調頻中、收訊不良時播放輕微雜音；收到訊號或關機就停
    if (s === 'loading' || s === 'error') this.staticOn(); else this.staticOff();
    this.onChange();
  }

  // ---------- 收訊雜音 (音量刻意壓低，避免嚇到人) ----------
  private noise: { src: AudioBufferSourceNode; gain: GainNode; ctx: AudioContext } | null = null;
  private static STATIC_VOL = 0.2; // 收訊不良雜音音量 20%
  private staticOn() {
    if (this.noise) return;
    const a = legacyAudio();
    if (!a) return;
    if (!a.ctx) a.init();
    const ctx: AudioContext | null = a.ctx;
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      // 白噪音 + 偶發的劈啪聲，聽起來像收音機沙沙聲
      d[i] = (Math.random() * 2 - 1) * 0.6 + (Math.random() < 0.0004 ? (Math.random() * 2 - 1) * 1.5 : 0);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 2200; bp.Q.value = 0.6;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(this.el.muted ? 0 : CarRadio.STATIC_VOL, ctx.currentTime, 0.15);
    src.connect(bp); bp.connect(gain); gain.connect(ctx.destination);
    src.start();
    this.noise = { src, gain, ctx };
  }
  private staticOff() {
    if (!this.noise) return;
    const n = this.noise;
    this.noise = null;
    n.gain.gain.setTargetAtTime(0, n.ctx.currentTime, 0.08);
    setTimeout(() => { try { n.src.stop(); } catch { /* 已停止 */ } }, 400);
  }

  /** 第一次開機時抓目錄：好事聯播網 + 台灣熱門電台 */
  // ---------- 自訂串流網址 (存在這台電腦的瀏覽器；目錄查不到時用) ----------
  static customUrl(name: string): string {
    try { return localStorage.getItem('ks-radio-url:' + name) || ''; } catch { return ''; }
  }
  setCustomUrl(i: number, url: string) {
    const st = this.stations[i];
    if (!st) return;
    try {
      if (url) localStorage.setItem('ks-radio-url:' + st.name, url);
      else localStorage.removeItem('ks-radio-url:' + st.name);
    } catch { /* 無痕模式等情況無法儲存，本次仍生效 */ }
    st.url = url || st.url;
    st.custom = !!url;
    this.tune(i);
  }

  /** 編號：1–8 鍵依序，飛碟電台固定 9 鍵；清單共 9 台 */
  private static numbered(main: Station[], ufo: Station): Station[] {
    const list: Station[] = main.slice(0, 8).map((st, i) => ({ ...st, key: String(i + 1) }));
    list.push({ ...ufo, key: '9' });
    // 玩家自訂的網址優先
    list.forEach(st => { const u = CarRadio.customUrl(st.name); if (u) { st.url = u; st.custom = true; } });
    return list;
  }

  private async loadDirectory() {
    if (this.loadedDirectory) return;
    this.loadedDirectory = true;
    const q = (name: string) => queryDirectory('/json/stations/search?name=' + encodeURIComponent(name) + '&countrycode=TW&hidebroken=true&order=clickcount&reverse=true&limit=5');
    const qAll = (name: string) => queryDirectory('/json/stations/search?name=' + encodeURIComponent(name) + '&countrycode=TW&hidebroken=false&limit=50');
    const [good, best, n989, ufo, top] = await Promise.all([
      qAll('好事'),
      qAll('Best Radio'),
      qAll('989'),
      q('飛碟'),
      queryDirectory('/json/stations/search?countrycode=TW&order=clickcount&reverse=true&hidebroken=true&limit=40'),
    ]);
    this.directoryOk = (good.length + best.length + n989.length + ufo.length + top.length) > 0;
    const currentKey = this.current?.key;
    const seen = new Set(PINNED.map(s => s.url));
    const pick = (list: DirEntry[]) => list.find(e => e.url_resolved && e.lastcheckok && !seen.has(e.url_resolved));

    // 好事聯播網候選 (好事港都比對見下方)
    const goodAll = [...good, ...best, ...n989];
    console.info('[收音機] 目錄中的好事聯播網候選：', goodAll.map(e => `${e.name} | ${e.url_resolved} | ok=${e.lastcheckok}`));
    // 好事港都：高雄 FM98.9（玩家實測可收聽）；名稱或網址含 98.9、989、港都、高雄、Kaohsiung 皆可
    const isPort = (e: DirEntry) => /98[.\s]?9|989|港都|高雄|kaohsiung/i.test(e.name + ' ' + e.url_resolved);
    const portList = goodAll.filter(isPort).sort((a, b) => b.lastcheckok - a.lastcheckok);
    const g = portList.find(e => e.url_resolved) || pick(good);
    if (!g) console.warn('[收音機] 目錄裡找不到好事港都 (98.9)');
    const goodSt: Station = g ? { name: '好事港都', url: g.url_resolved, note: '好事聯播網 高雄 FM98.9' } : { name: '好事港都', url: '', note: '好事聯播網 高雄 FM98.9' };
    if (g) seen.add(g.url_resolved);
    const u = pick(ufo);
    const ufoSt: Station = u ? { name: '飛碟電台', url: u.url_resolved, note: '飛碟聯播網' } : { name: '飛碟電台', url: '', note: '飛碟聯播網' };
    if (u) seen.add(u.url_resolved);
    const extra: Station[] = [];
    top.forEach(e => {
      if (!e.url_resolved || seen.has(e.url_resolved) || !e.lastcheckok) return;
      if (/警察廣播|警廣|飛碟|好事|Best\s*Radio|bestradio/i.test(e.name + e.url_resolved)) return; // 已有固定頻道 (含好事其他台)
      if (/九八|News\s*98|98\s*新聞/i.test(e.name)) return; // 依需求排除九八新聞台
      seen.add(e.url_resolved);
      extra.push({ name: tidyName(e.name), url: e.url_resolved });
    });
    // 1 警廣全國交通網、2 好事港都、3–5 警廣分台、6–8 熱門台、9 飛碟電台（共 9 台）
    this.stations = CarRadio.numbered([PINNED[0], goodSt, ...PINNED.slice(1), ...extra], ufoSt);
    const i = this.stations.findIndex(st => st.key === currentKey);
    this.index = i >= 0 ? i : 0;
    this.onChange();
  }

  power(on?: boolean) {
    this.wantOn = on ?? !this.wantOn;
    if (this.wantOn) {
      this.loadDirectory();
      this.play();
    } else {
      this.stopStream();
      this.set('off');
    }
  }

  next(dir = 1) {
    this.index = (this.index + dir + this.stations.length) % this.stations.length;
    if (this.wantOn) this.play(); else this.onChange();
  }

  /** 下車時暫停 (保留開關狀態，上車自動接續) */
  pauseForExit() { this.stopStream(); this.staticOff(); if (this.wantOn) { this.status = 'off'; this.onChange(); } }
  resumeOnEnter() { if (this.wantOn) this.play(); }

  syncMute() {
    const a = legacyAudio();
    const muted = !!(a && a.enabled === false);
    if (this.el.muted !== muted && this.noise) this.noise.gain.gain.setTargetAtTime(muted ? 0 : CarRadio.STATIC_VOL, this.noise.ctx.currentTime, 0.05);
    this.el.muted = muted;
  }

  /** 直接切到第 i 台 */
  tune(i: number) {
    if (i < 0 || i >= this.stations.length) return;
    this.index = i;
    if (!this.wantOn) this.power(true); else this.play();
  }

  private stopStream() {
    if (this.hls) { this.hls.destroy(); this.hls = null; }
    this.el.pause();
    this.el.removeAttribute('src');
    this.el.load();
  }

  private play() {
    this.stopStream();
    this.syncMute();
    const st = this.current;
    this.reason = '';
    this.set('loading');
    if (!st.url) {
      const why = this.directoryOk === false ? '連不到電台目錄 radio-browser.info，查不到這台的網址' : this.directoryOk === null ? '電台目錄查詢中，稍等再試' : '電台目錄裡找不到這台';
      setTimeout(() => this.fail(why), 600);
      return;
    }
    const myUrl = st.url;
    const isHls = /\.m3u8(\?|$)/i.test(st.url);
    const native = () => {
      this.el.src = st.url;
      this.el.play().catch((e: Error) => this.fail(e && e.name === 'NotAllowedError' ? '瀏覽器擋住自動播放，再按一次 R' : '電台串流無法開啟'));
    };
    console.info('[收音機] 播放', st.name, st.url, 'HLS:', isHls, '原生 HLS 支援:', JSON.stringify(this.el.canPlayType('application/vnd.apple.mpegurl')), 'hls.js 可用:', Hls.isSupported());
    if (isHls && Hls.isSupported()) {
      // m3u8 一律先用 hls.js：Chrome 會回報「可能支援」原生 HLS，但實際播放警廣串流失敗 (MEDIA_ERR_SRC_NOT_SUPPORTED)
      // hls.js 被伺服器擋時，最後再試一次原生播放
      const h = new Hls({ lowLatencyMode: false, manifestLoadingTimeOut: 8000 });
      this.hls = h;
      h.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal || this.current.url !== myUrl) return;
        console.warn('[收音機] hls.js 錯誤', st.name, st.url, data.type, data.details, data.response);
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          const status = data.response && data.response.code;
          this.hls?.destroy(); this.hls = null;
          this.reason = status === 403 ? '電台伺服器拒絕（403，可能擋海外或擋外部網站）' : status ? `電台伺服器回應 ${status}` : '連不到電台伺服器（網路不通，或伺服器不允許網頁直接讀取）';
          native();
        } else {
          this.fail('串流格式解析失敗');
        }
      });
      h.loadSource(st.url);
      h.attachMedia(this.el);
      h.on(Hls.Events.MANIFEST_PARSED, () => { this.el.play().catch(() => this.fail('瀏覽器擋住自動播放，再按一次 R')); });
    } else {
      native();
    }
    // 12 秒還沒出聲就當作收訊不良
    setTimeout(() => { if (this.status === 'loading' && this.current.url === myUrl) this.fail('連線逾時，電台沒有回應'); }, 12000);
  }

  private fail(why = '') {
    if (!this.wantOn) return;
    if (why && !this.reason) this.reason = why; // 保留最早、最具體的原因
    console.warn('[收音機] 收訊不良', this.current?.name, this.current?.url, '原因：', this.reason || why);
    this.stopStream();
    this.set('error');
  }

}
