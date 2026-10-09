/**
 * 手機版掛載點 (取代 field/index.ts)：舊版 SurveyorGameApp 建好後呼叫 window.onGameAppReady(app)。
 * 外業系統 (FieldDay、事件、分支) 原封不動；這裡接上手機版的玩家、相機、觸控、HUD、回合制選單。
 */
import * as THREE from 'three';
import type { GameApp, AnyObj } from '../field/legacy';
import { FieldDay } from '../field/fieldDay';
import { showMainMenu, setFaceHook } from '../field/ui';
import { JOBS, loadProgress, type JobId } from '../field/jobs';
import { installDebug } from '../field/debug';
import { installSaveLoad } from '../field/saveload';
import { openAudioPanel, closeAudioPanel } from '../field/sound';
import { MobilePlayer } from './player';
import { FollowCamera } from './camera';
import { TouchInput } from './input';
import { MobileHud } from './hud';
import { DriveTouch } from './driveTouch';
import { benchMenu } from './benchMenu';
import { installMobileDebug } from './debugMobile';
import { applyGfx } from './gfx';

(window as AnyObj).onGameAppReady = (app: GameApp) => {
  const player = app.player as unknown as MobilePlayer;
  const sm = app.sceneManager as AnyObj;
  applyGfx(sm);
  // 手機沒有 pointer lock：把呼叫變成 no-op，避免 Android Chrome 真的鎖游標
  const canvas = sm.renderer.domElement as HTMLCanvasElement;
  (canvas as AnyObj).requestPointerLock = () => undefined;

  benchMenu.install(app);
  const field = new FieldDay(app);
  app.levelsMap.field = field;
  player.blockers = () => field.walkBlockers();

  const cam = new FollowCamera(app, player);
  cam.setOccluders(field.yardOccluders());
  const input = new TouchInput(app, player, cam);
  const hud = new MobileHud(app, field);
  const drive = new DriveTouch(app, field, player, hud);

  // 對話時：人偶轉向對方、相機把兩人框進來
  setFaceHook((o) => {
    const obj = o as THREE.Object3D;
    if (!obj) return;
    const p = player.position;
    if (obj.userData?.type === 'npc') obj.rotation.y = Math.atan2(-(p.z - obj.position.z), p.x - obj.position.x);
    player.faceAt = { x: obj.position.x, z: obj.position.z };
    player.cancelWalk();
    cam.focus = { x: obj.position.x, z: obj.position.z };
  });
  // 對話框關掉後鏡頭回來
  const mo = new MutationObserver(() => {
    if (!document.querySelector('.dialog-backdrop, .qte')) { cam.focus = null; player.faceAt = null; }
  });
  mo.observe(document.body, { childList: true });

  // 聲音設定按鈕 (舊版 HUD 的按鈕在手機上隱藏，由 hud.ts 的圖示鍵開)
  window.addEventListener('ks-audio', () => openAudioPanel());
  window.addEventListener('keydown', (e) => { if (e.code === 'Escape' && document.getElementById('audio-panel')) { e.stopPropagation(); closeAudioPanel(); } }, true);

  app.onExtraKey = (e: KeyboardEvent) => {
    if (app.currentLevelObj === field) return field.onKey(e);
    return false;
  };

  // 每幀：人偶顯示、觸控標記、HUD、開車面板
  const origUpdate = field.update.bind(field);
  field.update = (dt: number) => {
    origUpdate(dt);
    player.avatar.visible = app.currentLevelObj === field && !field.inTruck && field.phase !== 'done';
    input.update(dt);
    hud.update(dt);
    drive.update(dt);
  };
  const origStart = field.start.bind(field);
  field.start = () => { origStart(); player.cancelWalk(); player.syncAvatar(); cam.snap(); };
  const origStop = field.stop.bind(field);
  field.stop = () => { origStop(); player.avatar.visible = false; player.cancelWalk(); drive.hide(); };

  const menu = () => {
    app.closeAllModals();
    player.avatar.visible = false;
    const pr = loadProgress();
    showMainMenu([
      { id: 'gnss', name: JOBS.gnss.menuName, desc: JOBS.gnss.menuDesc, done: pr.day1Done },
      { id: 'level', name: JOBS.level.menuName, desc: JOBS.level.menuDesc, done: pr.day2Done, locked: pr.day1Done ? undefined : '完成第一天後解鎖' },
      { id: 'gcp', name: JOBS.gcp.menuName, desc: JOBS.gcp.menuDesc, done: pr.day3Done, locked: pr.day2Done ? undefined : '完成第二天後解鎖' },
    ], (id) => { field.job = id as JobId; app.loadLevel('field'); });
  };
  (window as AnyObj).__showMainMenu = menu;
  installDebug(app, field, menu);
  installMobileDebug();
  installSaveLoad(app, field);
  (window as AnyObj).__mobile = { player, cam, input, hud, drive, field };

  // 背景先載入 CKSV 場景當主選單背景
  app.loadLevel('gnss');
  menu();
};
