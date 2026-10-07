import { describe, it, expect } from 'vitest';
import { SceneManager } from '../src/engine/sceneManager';

describe('SceneManager: Ambient Movements & Progression Sequencer', () => {
  it('initializes with a default ambient scene', () => {
    const sm = new SceneManager();
    const scenes = sm.getScenes();
    expect(scenes.length).toBe(1);
    expect(scenes[0].name).toContain('Scene 1');
    expect(scenes[0].durationSec).toBe(30);
    expect(sm.getCurrentScene().id).toBe(scenes[0].id);
  });

  it('adds and selects new scenes properly', () => {
    const sm = new SceneManager();
    const scene2 = sm.addScene('Scene 2: Ethereal Shimmer', 45);
    expect(sm.getScenes().length).toBe(2);
    expect(scene2.name).toBe('Scene 2: Ethereal Shimmer');
    expect(scene2.durationSec).toBe(45);

    // Select scene 2
    sm.selectScene(scene2.id);
    expect(sm.getCurrentScene().id).toBe(scene2.id);
    expect(sm.getCurrentSceneIndex()).toBe(1);
  });

  it('duplicates existing scene including parameters and strokes', () => {
    const sm = new SceneManager();
    sm.updateCurrentScene({
      name: 'Dawn Movement',
      bpm: 38,
      durationSec: 50,
      scaleId: 'lydian',
    });

    const dup = sm.duplicateCurrentScene();
    expect(sm.getScenes().length).toBe(2);
    expect(dup.name).toContain('(Copy)');
    expect(dup.bpm).toBe(38);
    expect(dup.durationSec).toBe(50);
    expect(dup.scaleId).toBe('lydian');
    expect(sm.getCurrentScene().id).toBe(dup.id);
  });

  it('deletes scenes but preserves at least one scene', () => {
    const sm = new SceneManager();
    const s2 = sm.addScene('Scene 2', 20);
    expect(sm.getScenes().length).toBe(2);

    const deleted = sm.deleteScene(s2.id);
    expect(deleted).toBe(true);
    expect(sm.getScenes().length).toBe(1);

    // Attempting to delete the last remaining scene fails
    const lastId = sm.getCurrentScene().id;
    const deletedLast = sm.deleteScene(lastId);
    expect(deletedLast).toBe(false);
    expect(sm.getScenes().length).toBe(1);
  });

  it('cycles through scenes when sequence playback is active', () => {
    const sm = new SceneManager();
    sm.getCurrentScene().durationSec = 10;
    const s2 = sm.addScene('Scene 2', 10);
    sm.setMorphDuration(3);

    sm.startSequence();
    expect(sm.isSequencing()).toBe(true);

    // Tick 5 seconds: half-way through Scene 1
    const t1 = sm.tickSequence(5.0);
    expect(t1.sceneChanged).toBe(false);
    expect(t1.progressRatio).toBeCloseTo(0.5);
    expect(t1.isMorphing).toBe(false);

    // Tick 3 seconds (total 8s): within morphing window (10 - 8 = 2s <= morphTime 3s)
    const t2 = sm.tickSequence(3.0);
    expect(t2.sceneChanged).toBe(false);
    expect(t2.isMorphing).toBe(true);
    expect(t2.morphRatio).toBeGreaterThan(0);

    // Tick 2.5 seconds (total 10.5s): exceeds duration, transitions to Scene 2
    const t3 = sm.tickSequence(2.5);
    expect(t3.sceneChanged).toBe(true);
    expect(t3.currentScene.id).toBe(s2.id);
  });

  it('exports and imports scenes accurately', () => {
    const sm = new SceneManager();
    sm.addScene('Movement B', 60);
    const exported = sm.exportScenes();
    expect(exported.length).toBe(2);

    const sm2 = new SceneManager(exported);
    expect(sm2.getScenes().length).toBe(2);
    expect(sm2.getScenes()[1].name).toBe('Movement B');
  });

  it('reorders scenes accurately when dragging/moving scene cards', () => {
    const sm = new SceneManager();
    const s1Id = sm.getCurrentScene().id;
    const s2 = sm.addScene('Scene 2', 20);
    const s3 = sm.addScene('Scene 3', 30);

    const initialScenes = sm.getScenes();
    expect(initialScenes.map((s) => s.id)).toEqual([s1Id, s2.id, s3.id]);

    // Move Scene 3 before Scene 1 (index 0)
    const moved = sm.reorderScene(s3.id, s1Id);
    expect(moved).toBe(true);

    const reorderedScenes = sm.getScenes();
    expect(reorderedScenes.map((s) => s.id)).toEqual([s3.id, s1Id, s2.id]);

    // Invalid reorder returns false
    expect(sm.reorderScene('non_existent', s1Id)).toBe(false);
    expect(sm.reorderScene(s3.id, s3.id)).toBe(false);
  });

  it('provides getNextScene and includes nextScene during morphing', () => {
    const sm = new SceneManager();
    sm.getCurrentScene().durationSec = 10;
    const s2 = sm.addScene('Scene 2', 15);
    sm.addScene('Scene 3', 20);

    expect(sm.getNextScene().id).toBe(s2.id);

    sm.setMorphDuration(4);
    sm.startSequence();

    // Advance 8s: into morphing window towards Scene 2
    const tick = sm.tickSequence(8.0);
    expect(tick.isMorphing).toBe(true);
    expect(tick.nextScene?.id).toBe(s2.id);
    expect(tick.morphRatio).toBeGreaterThan(0);
  });

  it('seeks current scene sequence playhead accurately with ratio clamping', () => {
    const sm = new SceneManager();
    sm.getCurrentScene().durationSec = 20;
    sm.addScene('Scene 2', 20);
    sm.setMorphDuration(4);
    sm.startSequence();

    // Seek to 90% (18s into 20s scene)
    sm.seekCurrentScene(0.9);
    const tick = sm.tickSequence(0);
    expect(tick.progressRatio).toBeCloseTo(0.9);
    expect(tick.isMorphing).toBe(true); // 20 - 18 = 2s <= 4s morph window

    // Clamping to 0.99 maximum
    sm.seekCurrentScene(1.5);
    const tickClamped = sm.tickSequence(0);
    expect(tickClamped.progressRatio).toBeCloseTo(0.99);

    // Clamping below 0
    sm.seekCurrentScene(-0.5);
    const tickZero = sm.tickSequence(0);
    expect(tickZero.progressRatio).toBeCloseTo(0.0);
  });

  it('supports configuring morph curve blend mode (equalPower, reverbWash, linear)', () => {
    const sm = new SceneManager();
    expect(sm.getMorphCurveMode()).toBe('equalPower');

    sm.setMorphCurveMode('reverbWash');
    expect(sm.getMorphCurveMode()).toBe('reverbWash');

    sm.setMorphCurveMode('linear');
    expect(sm.getMorphCurveMode()).toBe('linear');

    sm.setMorphCurveMode('equalPower');
    expect(sm.getMorphCurveMode()).toBe('equalPower');
  });
});
