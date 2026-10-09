/**
 * 舊版 (src/legacy) 全域物件的寬鬆型別。
 * 舊程式尚未改寫為 TS，這裡只描述新系統用到的部分。
 */
import type * as THREE from 'three';

/* eslint-disable @typescript-eslint/no-explicit-any */
export type AnyObj = any;

export interface SurveyModelsAPI {
  M: Record<string, THREE.Material>;
  mk(geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], x?: number, y?: number, z?: number, noShadow?: boolean): THREE.Mesh;
  rbox(w: number, h: number, d: number, r?: number): THREE.BufferGeometry;
  lathe(pts: number[][], seg?: number): THREE.BufferGeometry;
  rodBetween(a: THREE.Vector3, b: THREE.Vector3, rA: number, rB: number, mat: THREE.Material, seg?: number): THREE.Mesh;
  boxBetween(a: THREE.Vector3, b: THREE.Vector3, w: number, d: number, mat: THREE.Material): THREE.Mesh;
  canvasTex(w: number, h: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, opts?: { repeat?: [number, number] }): THREE.CanvasTexture;
  rng(seed: number): () => number;
  smoothstep(a: number, b: number, x: number): number;
  buildCase(w: number, h: number, d: number, mat: THREE.Material): THREE.Group;
  buildCone(): THREE.Group;
  buildFlagStake(): THREE.Group;
  [k: string]: any;
}

export interface SceneManager {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  interactiveObjects: THREE.Object3D[];
  benchmarks: THREE.Object3D[];
  tripods: THREE.Object3D[];
  trees: THREE.Object3D[];
  poleColliders: { x: number; z: number; r: number }[];
  parkedTruck: THREE.Object3D;
  heightAt(x: number, z: number): number;
  createFloatingHintArrow(x: number, z: number, label: string, color?: number, isDynamic?: boolean): THREE.Group;
  setVisibleFloatingPoints(k: string[] | string | null): void;
  clearDynamicProps(): void;
  floatingArrows: THREE.Group[];
  dynamicArrows: THREE.Group[];
  [k: string]: any;
}

export interface Player {
  position: THREE.Vector3;
  euler: THREE.Euler;
  camera: THREE.PerspectiveCamera;
  keys: Record<string, boolean>;
  isLocked: boolean;
  hoveredObject: THREE.Object3D | null;
  externalControl: ((dt: number) => void) | null;
  carrySpeedFactor?: number;
  noSprint?: boolean;
  isModalOpen(): boolean;
  hidePrompt(): void;
  [k: string]: any;
}

export interface GameApp {
  sceneManager: SceneManager;
  player: Player;
  levelsMap: Record<string, AnyObj>;
  levelManager: AnyObj;
  currentLevelId: string;
  currentLevelObj: AnyObj;
  campaignResults: Record<string, AnyObj>;
  loadLevel(id: string): void;
  updateMissionPanel(title: string, tasks: { id: number; text: string }[], active: number, hint: string): void;
  completeLevel(id: string, data: AnyObj): void;
  closeAllModals(): void;
  openModal(id: string): void;
  onExtraKey?: (e: KeyboardEvent) => boolean;
  [k: string]: any;
}

export const SM = (): SurveyModelsAPI => (window as AnyObj).SurveyModels;
export const audio = (): AnyObj => (window as AnyObj).surveyAudio;
