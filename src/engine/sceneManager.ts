import { SavedStroke, XAxisModulationMode, MorphCurveMode } from './types';

export interface SceneData {
  id: string;
  name: string;
  durationSec: number;
  bpm: number;
  scaleId?: string;
  rootId?: string;
  spaceReverb?: number;
  xAxisModulationMode?: XAxisModulationMode;
  strokes: SavedStroke[];
}

export interface SceneSequenceTickResult {
  sceneChanged: boolean;
  previousSceneId?: string;
  currentScene: SceneData;
  nextScene?: SceneData;
  progressRatio: number; // 0.0 to 1.0 within current scene
  isMorphing: boolean;
  morphRatio: number; // 0.0 (just started morph) to 1.0 (morph complete)
}

export class SceneManager {
  private scenes: SceneData[] = [];
  private currentSceneId: string = '';
  private isSequencePlaying: boolean = false;
  private morphDurationSec: number = 6.0;
  private morphCurveMode: MorphCurveMode = 'equalPower';
  private sequenceElapsedSec: number = 0;
  private idCounter: number = 1;

  constructor(initialScenes?: SceneData[]) {
    if (initialScenes && initialScenes.length > 0) {
      this.scenes = JSON.parse(JSON.stringify(initialScenes));
      this.currentSceneId = this.scenes[0].id;
    } else {
      const defaultScene: SceneData = {
        id: this.generateId(),
        name: 'Scene 1: Ambient Foundation',
        durationSec: 30,
        bpm: 32,
        scaleId: 'dorian',
        rootId: 'D2',
        spaceReverb: 0.65,
        xAxisModulationMode: 'panAndTone',
        strokes: [],
      };
      this.scenes = [defaultScene];
      this.currentSceneId = defaultScene.id;
    }
  }

  private generateId(): string {
    return `scene_${Date.now()}_${this.idCounter++}`;
  }

  public getScenes(): SceneData[] {
    return this.scenes;
  }

  public getCurrentScene(): SceneData {
    const scene = this.scenes.find((s) => s.id === this.currentSceneId);
    if (!scene) {
      if (this.scenes.length === 0) {
        const fallback: SceneData = {
          id: this.generateId(),
          name: 'Scene 1',
          durationSec: 30,
          bpm: 40,
          strokes: [],
        };
        this.scenes.push(fallback);
        this.currentSceneId = fallback.id;
        return fallback;
      }
      this.currentSceneId = this.scenes[0].id;
      return this.scenes[0];
    }
    return scene;
  }

  public getCurrentSceneIndex(): number {
    return Math.max(0, this.scenes.findIndex((s) => s.id === this.currentSceneId));
  }

  public addScene(name?: string, durationSec = 30, strokes: SavedStroke[] = []): SceneData {
    const index = this.scenes.length + 1;
    const current = this.getCurrentScene();
    const newScene: SceneData = {
      id: this.generateId(),
      name: name || `Scene ${index}: Movement ${index}`,
      durationSec: Math.max(5, Math.min(300, durationSec)),
      bpm: current.bpm,
      scaleId: current.scaleId,
      rootId: current.rootId,
      spaceReverb: current.spaceReverb,
      xAxisModulationMode: current.xAxisModulationMode,
      strokes: JSON.parse(JSON.stringify(strokes)),
    };
    this.scenes.push(newScene);
    return newScene;
  }

  public duplicateCurrentScene(customName?: string): SceneData {
    const current = this.getCurrentScene();
    const name = customName || `${current.name} (Copy)`;
    const newScene: SceneData = {
      ...JSON.parse(JSON.stringify(current)),
      id: this.generateId(),
      name,
    };
    const currentIndex = this.getCurrentSceneIndex();
    this.scenes.splice(currentIndex + 1, 0, newScene);
    this.currentSceneId = newScene.id;
    return newScene;
  }

  public deleteScene(sceneId: string): boolean {
    if (this.scenes.length <= 1) {
      return false; // Retain at least 1 scene
    }
    const idx = this.scenes.findIndex((s) => s.id === sceneId);
    if (idx === -1) return false;

    this.scenes.splice(idx, 1);
    if (this.currentSceneId === sceneId) {
      const nextIdx = Math.min(idx, this.scenes.length - 1);
      this.currentSceneId = this.scenes[nextIdx].id;
    }
    return true;
  }

  public selectScene(sceneId: string): SceneData | null {
    const target = this.scenes.find((s) => s.id === sceneId);
    if (target) {
      this.currentSceneId = target.id;
      this.sequenceElapsedSec = 0;
      return target;
    }
    return null;
  }

  public selectSceneByIndex(index: number): SceneData | null {
    if (index >= 0 && index < this.scenes.length) {
      this.currentSceneId = this.scenes[index].id;
      this.sequenceElapsedSec = 0;
      return this.scenes[index];
    }
    return null;
  }

  public updateCurrentScene(data: Partial<Omit<SceneData, 'id'>>): void {
    const current = this.getCurrentScene();
    if (data.name !== undefined) current.name = data.name;
    if (data.durationSec !== undefined) current.durationSec = Math.max(5, Math.min(300, data.durationSec));
    if (data.bpm !== undefined) current.bpm = data.bpm;
    if (data.scaleId !== undefined) current.scaleId = data.scaleId;
    if (data.rootId !== undefined) current.rootId = data.rootId;
    if (data.spaceReverb !== undefined) current.spaceReverb = data.spaceReverb;
    if (data.xAxisModulationMode !== undefined) current.xAxisModulationMode = data.xAxisModulationMode;
    if (data.strokes !== undefined) current.strokes = JSON.parse(JSON.stringify(data.strokes));
  }

  public renameScene(sceneId: string, name: string): void {
    const s = this.scenes.find((sc) => sc.id === sceneId);
    if (s && name.trim()) {
      s.name = name.trim();
    }
  }

  public setSceneDuration(sceneId: string, durationSec: number): void {
    const s = this.scenes.find((sc) => sc.id === sceneId);
    if (s) {
      s.durationSec = Math.max(5, Math.min(300, durationSec));
    }
  }

  public setSceneBpm(sceneId: string, bpm: number): void {
    const s = this.scenes.find((sc) => sc.id === sceneId);
    if (s) {
      s.bpm = Math.max(10, Math.min(240, Math.round(bpm)));
    }
  }

  // Sequence Playback & Morphing
  public startSequence(): void {
    this.isSequencePlaying = true;
    this.sequenceElapsedSec = 0;
  }

  public stopSequence(): void {
    this.isSequencePlaying = false;
    this.sequenceElapsedSec = 0;
  }

  public getNextScene(): SceneData {
    if (this.scenes.length <= 1) {
      return this.getCurrentScene();
    }
    const currentIdx = this.getCurrentSceneIndex();
    const nextIdx = (currentIdx + 1) % this.scenes.length;
    return this.scenes[nextIdx];
  }

  public reorderScene(fromId: string, toId: string): boolean {
    const fromIndex = this.scenes.findIndex((s) => s.id === fromId);
    const toIndex = this.scenes.findIndex((s) => s.id === toId);
    if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return false;
    const [moved] = this.scenes.splice(fromIndex, 1);
    this.scenes.splice(toIndex, 0, moved);
    return true;
  }

  public isSequencing(): boolean {
    return this.isSequencePlaying;
  }

  public getMorphDuration(): number {
    return this.morphDurationSec;
  }

  public setMorphDuration(seconds: number): void {
    this.morphDurationSec = Math.max(1, Math.min(30, seconds));
  }

  public getMorphCurveMode(): MorphCurveMode {
    return this.morphCurveMode;
  }

  public setMorphCurveMode(mode: MorphCurveMode): void {
    this.morphCurveMode = mode;
  }

  public getSequenceProgress(): { elapsed: number; total: number; ratio: number } {
    const current = this.getCurrentScene();
    const total = current.durationSec;
    const elapsed = this.sequenceElapsedSec;
    return {
      elapsed,
      total,
      ratio: Math.min(1.0, elapsed / Math.max(1, total)),
    };
  }

  /**
   * Seeks sequence playback within the current scene to a target ratio (0.0 to 0.99).
   */
  public seekCurrentScene(progressRatio: number): void {
    const current = this.getCurrentScene();
    const clamped = Math.max(0, Math.min(0.99, progressRatio));
    this.sequenceElapsedSec = clamped * current.durationSec;
  }

  /**
   * Advances the sequence by dtSec. If duration of the current scene expires,
   * advances to the next scene cyclically.
   */
  public tickSequence(dtSec: number): SceneSequenceTickResult {
    const current = this.getCurrentScene();
    if (!this.isSequencePlaying || this.scenes.length <= 1) {
      return {
        sceneChanged: false,
        currentScene: current,
        nextScene: current,
        progressRatio: 0,
        isMorphing: false,
        morphRatio: 0,
      };
    }

    this.sequenceElapsedSec += dtSec;
    const totalSec = current.durationSec;
    const morphTime = Math.min(this.morphDurationSec, totalSec * 0.5);
    const timeUntilChange = totalSec - this.sequenceElapsedSec;

    const isMorphing = timeUntilChange <= morphTime && timeUntilChange > 0;
    const morphRatio = isMorphing ? (morphTime - timeUntilChange) / morphTime : 0;
    const nextScene = this.getNextScene();

    if (this.sequenceElapsedSec >= totalSec) {
      const prevId = current.id;
      const currentIdx = this.getCurrentSceneIndex();
      const nextIdx = (currentIdx + 1) % this.scenes.length;
      this.currentSceneId = this.scenes[nextIdx].id;
      this.sequenceElapsedSec = 0;

      return {
        sceneChanged: true,
        previousSceneId: prevId,
        currentScene: this.scenes[nextIdx],
        nextScene: this.getNextScene(),
        progressRatio: 0,
        isMorphing: false,
        morphRatio: 0,
      };
    }

    return {
      sceneChanged: false,
      currentScene: current,
      nextScene,
      progressRatio: Math.min(1.0, this.sequenceElapsedSec / Math.max(1, totalSec)),
      isMorphing,
      morphRatio,
    };
  }

  public exportScenes(): SceneData[] {
    return JSON.parse(JSON.stringify(this.scenes));
  }

  public importScenes(scenes: SceneData[], activeId?: string): void {
    if (scenes && scenes.length > 0) {
      this.scenes = JSON.parse(JSON.stringify(scenes));
      this.currentSceneId = activeId && this.scenes.some((s) => s.id === activeId) ? activeId : this.scenes[0].id;
      this.sequenceElapsedSec = 0;
    }
  }
}
