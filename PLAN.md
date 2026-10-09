# 鍵盤測量員 手機版（2.5D）移植計畫

專案：`iamsurveyor-mobile`（從鍵盤測量員 v5.0 複製後獨立修改，不動桌機版）。
建置指令不變：`npx tsc --noEmit -p . && npm run build` → `dist/index.html`。

已和使用者確認的方向：
- 仍是網頁遊戲，手機操作。
- 沿用 3D 世界與模型，固定斜俯視追隨相機（寶可夢 3DS 風格）；世界地圖與桌機完全一致。
- 保留所有故事、事件、分支、跨天人情、因果紀錄、尾聲；儀器小遊戲全部改成回合制指令選單。
- 走路：點地自動尋路；開車、後斗擺放保留簡化的觸控小遊戲。
- 第一里程碑：完整框架＋第一天可玩，試過再做第二、三天。

---

## A. 架構：抄什麼、包什麼、換什麼

### A1. 耦合點與處置
| 耦合點 | 位置 | 手機版處置 |
|---|---|---|
| 鍵盤／滑鼠／Pointer Lock 走路 | `src/legacy/player.js` `SurveyPlayer` | **整個換掉**：新 `src/mobile/player.ts` `MobilePlayer`，維持同一介面（`position`、`euler`、`camera`、`keys`、`externalControl`、`hoveredObject`、`raycaster`、`carrySpeedFactor`、`noSprint`、`isModalOpen()`、`hidePrompt()`、`update(dt)`、`setDroneMode()`）。`main.js` 查 `window.SurveyPlayer`，所以 `main.ts` 改 import `mobile/player.ts` 即可，`main.js` 零修改。 |
| 相機＝玩家眼睛 | `fieldDay.ts` 的 `p.camera.position.copy(p.position)`（`start`、`restore`、`collidePlayer`、`exitTruck`），bench/cine/gcpBench/rtkBench/scope 離開時也寫回 | **不改**。在 `sceneManager.render` 前由 `mobile/camera.ts` 的追隨相機覆寫（同 `bench.install` 包 `sm.render` 的做法）。`player.externalControl == null` 且非 `cine-active`/`bench-active` 時歸追隨相機；開車（`truck.updateChaseCam`）、登場運鏡各自保留。 |
| 手持物掛在相機下 | `fieldDay.ts` `hold`、`setExtra`、`dropHeld`、`shelve`、`openLoader`、`consumeHeld`、`buildOnce` | 新增 `FieldDay.handAnchor()` 回傳 `player.hand ?? camera`；7 處 `cam.add/remove` 改用它。`MobilePlayer.hand` 是人偶右手。 |
| 準心互動 E | `player.triggerInteraction` → `app.handleInteraction(obj)` → `FieldDay.onInteract/getInteractionPrompt/getFreeInteractPrompt/onFreeInteract` | **全保留**；手機「點物件 → 自動走過去 → 到了呼叫 `app.handleInteraction(obj)`」。 |
| 額外按鍵 G/F/R/N/B/L/J/H/M/Q/C、`sub.onKey` | `fieldDay.onKey`、`index.ts`、`gcpJob.ts`、`levelJob.ts` | `mobile/hud.ts` 動作列按鈕合成 `KeyboardEvent` 丟給原處理器。 |
| 對話／派工單／報告／主選單 | `ui.ts` | 邏輯逐字保留，只改 CSS（底部 sheet、大按鈕、隱藏數字鍵帽）。 |
| `isModalOpen()` 語意 | `player.js`、`bench.install`、`siteEvents.canTalk/intro` | `MobilePlayer.isModalOpen()` = `.modal-backdrop.show` ∪ `body.bench-active` ∪ `body.cine-active` ∪ `.m-sheet.open`。回合制選單用 `ui.ts` 同款 `overlay()`，事件導演就會像桌機一樣等你選完。 |
| 儀器 3D 近距離操作 | `bench.ts` `install(app)` 猴子補丁 `LevelGNSS.prototype.open*Modal` | 同一補丁點換成 `mobile/benchMenu.ts`。`LevelGNSS` 物理與評分（`recalculateTribrachPhysics`、`screwA/B/C`、`shiftX/Y`、`finalCenteringErrorMm`、`tapeReadingErrorMm`、`finishLevel`）**原封不動**，存檔欄位不變。 |
| QTE | `qte.ts` `runQTE`（`siteEvents.kidQTE`、`levelJob`、`uav.ts`） | 同名同簽章換實作 `mobile/qteMenu.ts`，vite alias `./qte` 指過去，呼叫端零修改。 |
| 登場運鏡 | `cine.ts` 只能按鍵略過 | 加 `pointerdown` 略過（1 行）。 |
| 轉向說話者 | `look.ts` `faceObject` | 人偶轉向對方＋相機把目標點移到兩人中間、FOV 收窄。 |
| 地面瞄準 | `gcpJob.groundAim`、`levelJob` | 第 2/3 天改讀 `player.aimPoint`；第一天不碰。 |
| 存讀檔 | `saveload.ts`、`jobs.ts` Progress | **格式不變**；多加瀏覽器內快速存檔槽（同一份 `snapshot()`）。 |
| 測試工具 | `debug.ts` F9 | 改「長按左上品牌 1.2 秒」或網址 `#debug`；面板與 `start()` 全部重用，加手機 CSS。 |

### A2. 目錄
- 原封不動：`src/legacy/{audio,models,scene,level_*}.js`、`src/field/{siteEvents,story,jobs,items,trunk,truck,world,nav,npc,police,fx,sound,sfx,radio,ending,saveload,levelJob,gcpJob,gcpEvents,gcpSite,uav,levelStaff,scope,rtkBench,gcpBench}.ts`。
- 微改：`fieldDay.ts`（`handAnchor`）、`cine.ts`、`ui.ts`（`showTrunkView` 兩段式）、`index.ts`、`main.ts`、`scene.js`（效能參數讀 `window.__mobileGfx`）。
- 新增 `src/mobile/`：`player.ts`、`camera.ts`、`pathfind.ts`、`input.ts`、`hud.ts`、`sheet.ts`、`benchMenu.ts`、`qteMenu.ts`、`driveTouch.ts`、`debugMobile.ts`、`index.ts`、`styles/mobile.css`。

---

## B. 相機與渲染

### B1. 追隨相機（`mobile/camera.ts`）
- 透視相機、窄 FOV 32°、俯角 52°、距離 11 m、方位固定面向北（−Z）。不用正交：霧、雲 sprite、浮空箭頭、威脅投影都靠透視。
- 目標點＝玩家腳底＋1.0 m，`lerp(dt*6)`，接管瞬間 snap；`cam.y ≥ heightAt+1.2`。
- 對話取景：目標改兩人中點、FOV 26°、0.5 s。
- 遮擋：器材室屋頂／後牆登記為 occluders，玩家在屋內時屋頂隱藏、後牆半透明；樹冠對「相機與玩家連線 15 m 內的樹」做包圍球測試，命中的淡到 0.3（葉材質每棵 clone）。
- 開車沿用 `truck.updateChaseCam`，直式改 (7.5, 4.2)。

### B2. 效能預算（`scene.js` 讀 `window.__mobileGfx`）
- `setPixelRatio(min(dpr,1.5))`，連續 30 幀 >24 ms 降到 1.0；antialias 只在 dpr≤1。
- 陰影 1024、半寬 24；低階機（Mali-4xx／Adreno 5xx／deviceMemory≤3）關陰影、加亮 hemi 光。
- 草 14000/1400 → 6000/600，低階 2500。霧 60–240、`camera.far=400`、anisotropy 4。
- 目標：中階 Android 30 fps、iPhone 60 fps、draw calls <250。

---

## C. 輸入與 UX

### C1. 方向：直式（portrait）
單手拇指；對話／指令是主要互動，底部 sheet 高度足夠；俯角相機的上方視野對應行走方向。橫式用 CSS 改成右側欄，保證可用但不另調校。

### C2. 點地走路（`pathfind.ts` + `MobilePlayer`）
- 局部格狀 A*：玩家與目標外框各擴 8 m、格距 0.5 m（上限 120×120）。障礙來源＝既有圓形碰撞：`yardColliders`、車身矩形、`events.bodies()`、`sub.bodies()`、樹 r0.6、電線桿、水準點 0.45、坡度 |∇h|>0.8。新增 `FieldDay.walkBlockers()` 集中輸出。
- 路徑 LOS 拉直；`collidePlayer` 仍是最後防線。
- 點擊順序：互動物件（`getInteractionPrompt` 非 null）→ 事件黃圈 → 地面走路（設 `aimPoint`）。
- 到達（≤2.2 m）後面向目標直接執行（桌機也是一鍵 E）。目標是 NPC 時每 0.5 s 重算。

### C3. HUD（直式、拇指區）
- 頂：左＝目前步驟一行（點開＝手簿 sheet，內容即 `#mission-panel`）；右＝手簿／存檔／音量。
- 中：3D；toast 在提示列下；威脅條照舊；水分條小型化右上。
- 底動作列 72 px：`放下(G)`、`喝水(F)`、`查看後斗`、`上下車`，第 2/3 天再加 `地圖(Q)`、`拍照(C)`、`對講機(Y)`、`扛儀器(R)`；每 0.2 s 依狀態重算。
- 對話改底部 sheet，選項 ≥56 px。

### C4. 開車（`driveTouch.ts`）
- 左下方向盤滑桿（放手回正，連續值 → `truck.drive` 的 steer）。右下油門／煞車倒車大鍵、手煞車、下車、收音機 sheet（重用 `setRadioPanel`）。
- `maxSpeed×0.85`、steer 平滑 6→8；導航箭頭／路牌不變；碰撞、喇叭、路中停車計分不變。

### C5. 後斗（`showTrunkView` 兩段式）
- 放入：第一下＝預覽（紅色＝不行與原因），再點同格＝放下；底部 `旋轉`／`取消`；格子 ≥52 px。
- 取出：點方塊顯示原因與「拿出」。

### C6. 阿黃黃圈
登場運鏡後三選一：`衝到腳架前擋住`（自動跑到黃圈；離腳架 >7 m 就來不及——陷阱）、`大喊阿黃！`（骰 50% 狗猶豫 1.5 s）、`不管牠`。撞擊結果、`dogOutcome`、因果紀錄全走 `siteEvents` 原邏輯。

---

## D. 第一天回合制規格（`benchMenu.ts`；通用「指令選單」＝標題＋狀態面板＋2–5 個大鍵，每按一次＝一回合；`roll()` 可被 `window.__ksDebug.seed` 固定）

### D1. 基座定心定平（資料仍是 `LevelGNSS` 的 `screwA/B/C、shiftX/Y`）
- 狀態面板：SVG 光學對點器（黑點）＋圓水準器（氣泡），數值顯示但**不標合格線**（陷阱：要自己記得 ≤1 mm、氣泡在圈內）。
- 指令：`平移基座`（↑↓←→ 每步 0.06；`微調` 0.03）、`轉腳螺旋`（A/B/C 順／逆；一般 ±1 加骰 ±0.2 手感誤差；`慢慢轉` ±0.5 無誤差）、`鎖定`、`離開`。
- 物理照舊：轉螺旋拉走對點 0.35，不交替修就鎖不好；未達標 `鎖定` 沿用兩段確認。每 6 回合骰 15% 小擾動（風、阿伯靠近）。
- 完成寫回 `finalCenteringErrorMm/finalLevelingErrorMm`、`currentStep=2`；被碰腳架打亂後重開選單即可。

### D2. 量天線斜高
- 真值沿用 `bench.setupTape` 幾何（無模型時 1.6843）。
- 回合 1「零點壓哪裡」：標石中心十字 ✔／標石邊緣 +0.012／地面 +0.028。
- 回合 2「拉到哪裡」：天線量高缺口 ✔／天線頂 +0.055／底盤外緣 −0.018。錯誤不提示，只在報告看到。
- 回合 3「讀數」：2D 捲尺放大鏡（移植 `drawTapeMeasureCanvas` loupe，手指拖動），`inputmode=decimal` 輸入 4 位小數；可 `再量一次取平均`。
- 寫回 `playerInputSlantHeight`、`tapeReadingErrorMm`、`slantHeightMeasured`、`currentStep=3`。

### D3. 手簿靜態觀測
- `點名`（CKSV ✔／CKSU／BM-01，選錯 `gnssScore −10` 並在報告附註）、`天線高`（自動帶入；斜高／垂直高型別，選錯等同 +0.0058 m）、`開始記錄`。
- 記錄 5 秒進度條（沿用 `epochsRecorded`），期間事件照常打斷；完成 `finishLevel()` → `onGnssDone`。

### D4. 小朋友 QTE（`qteMenu.ts`，簽章同 `runQTE`）
每波顯示台詞＋3 個回應、4 秒計時圈（`slow` 倍率沿用）；回應池 1 好 2 壞隨機混；全對 `onDone(true)` 進既有 `kidQuiet`；錯或超時 `onDone(false)`。`onStep(i)` 每波回呼（老鷹用）。

### D5. 其餘第一天事件
阿伯 5 分支、茶、地主／里長、警察、阿姨／界樁／鄰居、組長來電：全是 `showDialog`，零修改；「Space 停車」文字改「按手煞車」。

### D6. 第二天對照（下一里程碑）
整平直接重用 D1；望遠鏡改「對準目標／調焦粗細／量測／等貨車過去再讀」選單（`measure()`、擋視線邏輯沿用）；扶尺改讀數前「站姿」一回合＋風力骰；交通錐點地面＋選方向；R/Y/E 變動作列按鈕。

### D7. 第三天對照
選點點地面（`aimPoint`），陷阱判定不變；`gcpBench` 改鋪模板方向 4 選 → 噴白高度×次數（骰＋風）→ 轉遮板次數 → 噴黑 → 敲釘時機選單，輸出仍填 `GcpWorkResult`；`rtkBench` 改 `立桿看氣泡／等 30 s／記錄 3 筆`；拍照選參考地物；無人機平板改 pointer 事件、指南針干擾改選單骰、老鷹走 D4；電腦流程已是按鈕。

---

## E. 第一里程碑任務

| # | 任務 | 檔案 | 規模 |
|---|---|---|---|
| 1 | 建新專案、`main.ts` 改 import、vite alias、`index.html` viewport、`mobile.css` 骨架、隱藏桌機 HUD | `main.ts`、`vite.config.ts`、`index.html` | S |
| 2 | `MobilePlayer`（介面相容、人偶＋`hand`、沿路徑移動、`isModalOpen`、`aimPoint`） | `mobile/player.ts` | M |
| 3 | 追隨相機＋遮擋＋對話取景；`handAnchor` 7 處；屋頂／牆可淡化 | `camera.ts`、`fieldDay.ts`、`world.ts` | M |
| 4 | `pathfind.ts`＋`walkBlockers()`；`input.ts`；互動到達執行 | `pathfind.ts`、`input.ts` | M |
| 5 | HUD／動作列／手簿 sheet／對話 sheet；toast；`setHud` | `hud.ts`、`sheet.ts`、`mobile.css` | M |
| 6 | 效能參數化＋低階偵測＋動態解析度 | `scene.js`、`mobile/index.ts` | S |
| 7 | 後斗兩段式觸控 | `ui.ts` | S |
| 8 | 開車觸控＋收音機 sheet | `driveTouch.ts`、`fieldDay.driveTick` | M |
| 9 | 回合制：定心定平／斜高／手簿 | `benchMenu.ts` | L |
| 10 | QTE 選單版＋阿黃指令＋cine 點擊略過 | `qteMenu.ts`、`siteEvents.ts`、`cine.ts` | M |
| 11 | 測試工具長按＋手機 CSS；快速存檔槽 | `debugMobile.ts`、`saveload.ts` | S |
| 12 | 全流程手測與修正 | — | M |

### 測試計畫（Playwright＋swiftshader，`devices['iPhone 13']`、Pixel 5）
暴露 `window.__mobile = { tapWorld, tapObject, menu:{options,pick}, drive:{set}, step }`。案例：T1 啟動／像素比；T2 備料與後斗兩段式；T3 駕駛到 `park` → `phase==='site'`；T4 架設三個選單（含故意選錯零點 → `tapeReadingErrorMm > 10`）；T5 五分支阿伯、阿黃、小朋友、地主、警察、阿姨、回程來電，核對 `m.pr` 與 `getStory().chain`；T6 報告列標籤不變、`day1Done`；T7 存讀檔來回；T8 draw calls／截圖。

---

## F. 風險與待確認
1. 效能：低階 Android 需真機測，已有降級路線。
2. 相機固定北向：建議先不給轉向鍵（保持寶可夢感）。
3. 阿黃：目前「指令＋自動跑，能不能擋到看距離」；若要純骰子一行可改。
4. iOS：hls.js 需改原生 `<audio src=m3u8>`，第一里程碑先標示 iOS 暫不支援串流。
5. 存檔：iOS 下載進「檔案」App；另加瀏覽器內快速存檔槽。
6. 字型：單檔 HTML 仍連 Google Fonts，弱網退回系統字。
7. 直式是否同意；橫式僅保證可用。
8. 斜高／手簿新增的陷阱分數併入既有「GNSS 觀測品質」列，不新增報告列。
