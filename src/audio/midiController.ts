import type { DrumZone } from './drumMapping';
import { readStorageKey, writeStorageKey } from '../ui/storage';

export interface MidiDeviceInfo {
  id: string;
  name: string;
  manufacturer?: string;
}

export type MidiChannelMode =
  | 'auto'
  | '1'
  | '2'
  | '3'
  | '4'
  | '5'
  | '6'
  | '7'
  | '8'
  | '9'
  | '10'
  | '11'
  | '12'
  | '13'
  | '14'
  | '15'
  | '16';

export type MidiLearnTarget =
  | 'bpm'
  | 'reverb'
  | 'stereoWidth'
  | 'tapeWarmth'
  | 'ducking'
  | 'swing'
  | 'selectedFilter'
  | 'selectedDistortion'
  | 'selectedVolume';

export type MidiCcCallback = (target: MidiLearnTarget, normalizedValue: number, cc: number) => void;

const MIDI_CC_STORAGE_KEY = 'harmonic_midi_cc_map';

const DEFAULT_CC_MAP: Record<number, MidiLearnTarget> = {
  14: 'bpm',
  1: 'reverb',
  10: 'stereoWidth',
  71: 'selectedDistortion',
  74: 'selectedFilter',
  7: 'selectedVolume',
  15: 'swing',
  72: 'tapeWarmth',
  73: 'ducking',
};

const VALID_LEARN_TARGETS = new Set<MidiLearnTarget>([
  'bpm',
  'reverb',
  'stereoWidth',
  'tapeWarmth',
  'ducking',
  'swing',
  'selectedFilter',
  'selectedDistortion',
  'selectedVolume',
]);

const AUTO_CHANNEL_MAP: Record<string, number> = {
  indigo: 0,
  amber: 1,
  spruce: 2,
  violet: 3,
  rose: 4,
  yellow: 5,
  slate: 5,
  onyx: 9,
};

/**
 * Converts a frequency in Hz to the nearest 7-bit MIDI note number [0..127].
 */
export function freqToMidiNote(freq: number): number {
  return Math.max(0, Math.min(127, Math.round(69 + 12 * Math.log2(Math.max(20, freq) / 440))));
}

/**
 * Maps an Onyx drum zone (and tom pitch) to a General MIDI percussion note on Channel 10.
 */
export function drumZoneToGmNote(zone: DrumZone, tomFreq: number = 120): number {
  switch (zone) {
    case 'kick':
      return 36;
    case 'snare':
      return 38;
    case 'clap':
      return 39;
    case 'hihat':
      return 42;
    case 'tom':
      return tomFreq < 140 ? 45 : tomFreq < 180 ? 47 : 48;
  }
}

interface ActiveDroneNote {
  ch: number;
  note: number;
  lastCcTime: number;
}

interface PendingPulseOff {
  timer: ReturnType<typeof setTimeout>;
  ch: number;
  note: number;
}

function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function loadStoredCcMap(): Record<number, MidiLearnTarget> {
  const raw = readStorageKey(MIDI_CC_STORAGE_KEY);
  if (!raw) {
    return { ...DEFAULT_CC_MAP };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ...DEFAULT_CC_MAP };
    }
    const loaded: Record<number, MidiLearnTarget> = {};
    let count = 0;
    for (const [key, val] of Object.entries(parsed as Record<string, unknown>)) {
      const cc = Number(key);
      if (
        Number.isInteger(cc) &&
        cc >= 0 &&
        cc <= 127 &&
        typeof val === 'string' &&
        VALID_LEARN_TARGETS.has(val as MidiLearnTarget)
      ) {
        loaded[cc] = val as MidiLearnTarget;
        count++;
      }
    }
    return count > 0 ? loaded : { ...DEFAULT_CC_MAP };
  } catch {
    return { ...DEFAULT_CC_MAP };
  }
}

/**
 * Browser-native Web MIDI I/O controller supporting polyphonic Note Out,
 * per-stroke drone CC modulation, General MIDI Channel 10 drums, and persistent CC MIDI Learn.
 */
export class MidiController {
  private access: MIDIAccess | null = null;
  private enabled = false;
  private selectedOutputId: string | null = null;
  private outputExplicitlyCleared = false;
  private selectedInputId: string | null = 'all';
  private channelMode: MidiChannelMode = 'auto';

  private activeDroneNotes = new Map<string, ActiveDroneNote>();
  private activePulseOffs = new Set<PendingPulseOff>();

  private ccMap: Record<number, MidiLearnTarget>;
  private learningTarget: MidiLearnTarget | null = null;
  private learningCallback: ((cc: number, target: MidiLearnTarget) => void) | null = null;

  public onControlChange?: MidiCcCallback;
  public onDevicesChange?: () => void;

  constructor() {
    this.ccMap = loadStoredCcMap();
  }

  public isSupported(): boolean {
    return typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function';
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public async enable(): Promise<{ supported: boolean; outputs: MidiDeviceInfo[]; inputs: MidiDeviceInfo[] }> {
    if (!this.isSupported()) {
      return { supported: false, outputs: [], inputs: [] };
    }

    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
    } catch {
      this.enabled = false;
      return { supported: false, outputs: [], inputs: [] };
    }

    this.enabled = true;
    const outputs = this.getOutputs();
    const inputs = this.getInputs();

    if (this.selectedOutputId === null && !this.outputExplicitlyCleared && outputs.length > 0) {
      this.selectedOutputId = outputs[0].id;
    } else if (
      this.selectedOutputId !== null &&
      !outputs.some((o) => o.id === this.selectedOutputId)
    ) {
      this.selectedOutputId = outputs[0]?.id ?? null;
    }

    this.attachInputListeners();
    this.access.onstatechange = () => {
      this.refreshPortBindings();
      this.onDevicesChange?.();
    };

    return { supported: true, outputs, inputs };
  }

  public disable(): void {
    this.allNotesOff();
    this.detachInputListeners();
    if (this.access) {
      this.access.onstatechange = null;
    }
    this.learningTarget = null;
    this.learningCallback = null;
    this.enabled = false;
  }

  public getOutputs(): MidiDeviceInfo[] {
    if (!this.access) return [];
    const list: MidiDeviceInfo[] = [];
    this.access.outputs.forEach((port) => {
      list.push({
        id: port.id,
        name: port.name ?? port.id,
        manufacturer: port.manufacturer ?? undefined,
      });
    });
    return list;
  }

  public getInputs(): MidiDeviceInfo[] {
    if (!this.access) return [];
    const list: MidiDeviceInfo[] = [];
    this.access.inputs.forEach((port) => {
      list.push({
        id: port.id,
        name: port.name ?? port.id,
        manufacturer: port.manufacturer ?? undefined,
      });
    });
    return list;
  }

  public setOutput(id: string | null): void {
    if (this.selectedOutputId !== id) {
      this.allNotesOff();
    }
    this.selectedOutputId = id;
    this.outputExplicitlyCleared = id === null;
  }

  public setInput(id: string | null): void {
    this.selectedInputId = id;
    this.attachInputListeners();
  }

  public setChannelMode(mode: MidiChannelMode): void {
    if (this.channelMode !== mode) {
      this.allNotesOff();
      this.channelMode = mode;
    }
  }

  public getChannelMode(): MidiChannelMode {
    return this.channelMode;
  }

  public sendPulseNote(
    instrumentId: string,
    freq: number,
    velocity: number,
    durationMs: number,
    isDrum?: boolean,
    drumZone?: DrumZone,
    tomFreq?: number
  ): void {
    if (!this.enabled) return;
    const output = this.getActiveOutput();
    if (!output) return;

    const drum = Boolean(isDrum) || instrumentId === 'onyx';
    const ch = this.resolveChannel(instrumentId, drum);
    const note = drum ? drumZoneToGmNote(drumZone ?? 'kick', tomFreq ?? 120) : freqToMidiNote(freq);
    const vel = this.normalizeVelocity(velocity);

    this.safeSend(output, [0x90 | ch, note, vel]);

    const holdMs = Math.max(10, Math.round(durationMs));
    const entry: PendingPulseOff = {
      timer: setTimeout(() => {
        this.activePulseOffs.delete(entry);
        const currentOutput = this.getActiveOutput();
        if (currentOutput) {
          this.safeSend(currentOutput, [0x80 | ch, note, 0]);
        }
      }, holdMs),
      ch,
      note,
    };
    this.activePulseOffs.add(entry);
  }

  public updateDroneNote(
    strokeId: string,
    instrumentId: string,
    freq: number,
    velocity: number,
    normX: number,
    curvature: number,
    filterCutoff: number
  ): void {
    if (!this.enabled) return;
    const output = this.getActiveOutput();
    if (!output) return;

    const ch = this.resolveChannel(instrumentId, instrumentId === 'onyx');
    const note = freqToMidiNote(freq);
    const vel = this.normalizeVelocity(velocity);
    const now = nowMs();

    const prev = this.activeDroneNotes.get(strokeId);
    if (!prev) {
      this.safeSend(output, [0x90 | ch, note, vel]);
      this.activeDroneNotes.set(strokeId, { ch, note, lastCcTime: 0 });
    } else if (prev.ch !== ch || prev.note !== note) {
      this.safeSend(output, [0x80 | prev.ch, prev.note, 0]);
      this.safeSend(output, [0x90 | ch, note, vel]);
      prev.ch = ch;
      prev.note = note;
    }

    const active = this.activeDroneNotes.get(strokeId)!;
    if (now - active.lastCcTime >= 40) {
      active.lastCcTime = now;
      const ccPan = this.toMidiCcValue(normX);
      const ccMod = this.toMidiCcValue(curvature * 200);
      const ccCutoff = this.toMidiCcValue(filterCutoff);
      this.safeSend(output, [0xb0 | ch, 10, ccPan]);
      this.safeSend(output, [0xb0 | ch, 1, ccMod]);
      this.safeSend(output, [0xb0 | ch, 74, ccCutoff]);
    }
  }

  public stopDroneNote(strokeId: string): void {
    const prev = this.activeDroneNotes.get(strokeId);
    if (!prev) return;
    this.activeDroneNotes.delete(strokeId);
    const output = this.getActiveOutput();
    if (output) {
      this.safeSend(output, [0x80 | prev.ch, prev.note, 0]);
    }
  }

  public allNotesOff(): void {
    const output = this.getActiveOutput();

    for (const entry of this.activePulseOffs) {
      clearTimeout(entry.timer);
      if (output) {
        this.safeSend(output, [0x80 | entry.ch, entry.note, 0]);
      }
    }
    this.activePulseOffs.clear();

    for (const active of this.activeDroneNotes.values()) {
      if (output) {
        this.safeSend(output, [0x80 | active.ch, active.note, 0]);
      }
    }
    this.activeDroneNotes.clear();

    if (output) {
      for (let ch = 0; ch < 16; ch++) {
        this.safeSend(output, [0xb0 | ch, 123, 0]);
      }
    }
  }

  public startMidiLearn(
    target: MidiLearnTarget,
    onLearned?: (cc: number, target: MidiLearnTarget) => void
  ): void {
    this.learningTarget = target;
    this.learningCallback = onLearned ?? null;
  }

  public cancelMidiLearn(): void {
    this.learningTarget = null;
    this.learningCallback = null;
  }

  public getLearningTarget(): MidiLearnTarget | null {
    return this.learningTarget;
  }

  public getCcMap(): Record<number, MidiLearnTarget> {
    return { ...this.ccMap };
  }

  public handleMidiMessage(data: Uint8Array): void {
    if (!data || data.length < 3) return;
    const status = data[0] & 0xf0;
    if (status !== 0xb0) return;

    const cc = data[1] & 0x7f;
    const value = data[2] & 0x7f;

    if (this.learningTarget) {
      const target = this.learningTarget;
      const cb = this.learningCallback;
      for (const existingKey of Object.keys(this.ccMap)) {
        const numKey = Number(existingKey);
        if (this.ccMap[numKey] === target) {
          delete this.ccMap[numKey];
        }
      }
      this.ccMap[cc] = target;
      writeStorageKey(MIDI_CC_STORAGE_KEY, JSON.stringify(this.ccMap));
      this.learningTarget = null;
      this.learningCallback = null;
      cb?.(cc, target);
      return;
    }

    const mappedTarget = this.ccMap[cc];
    if (mappedTarget) {
      this.onControlChange?.(mappedTarget, value / 127, cc);
    }
  }

  private resolveChannel(instrumentId: string, isDrum?: boolean): number {
    if (this.channelMode !== 'auto') {
      const parsed = Number(this.channelMode);
      if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 16) {
        return parsed - 1;
      }
    }
    if (isDrum || instrumentId === 'onyx') {
      return 9;
    }
    return AUTO_CHANNEL_MAP[instrumentId] ?? 0;
  }

  private normalizeVelocity(velocity: number): number {
    return Math.max(1, Math.min(127, Math.round(Math.max(0, Math.min(1, velocity)) * 127)));
  }

  private toMidiCcValue(normalized: number): number {
    return Math.max(0, Math.min(127, Math.round(Math.max(0, Math.min(1, normalized)) * 127)));
  }

  private getActiveOutput(): MIDIOutput | null {
    if (!this.access || !this.selectedOutputId) return null;
    let found: MIDIOutput | null = null;
    this.access.outputs.forEach((port) => {
      if (port.id === this.selectedOutputId) {
        found = port;
      }
    });
    return found;
  }

  private safeSend(output: MIDIOutput, bytes: number[]): void {
    try {
      output.send(bytes);
    } catch {
      // Ignored if port disconnected mid-stream
    }
  }

  private attachInputListeners(): void {
    if (!this.access) return;
    this.access.inputs.forEach((input) => {
      const shouldListen =
        this.enabled &&
        this.selectedInputId !== null &&
        (this.selectedInputId === 'all' || input.id === this.selectedInputId);
      if (shouldListen) {
        input.onmidimessage = (event: MIDIMessageEvent) => {
          if (event.data) {
            this.handleMidiMessage(event.data);
          }
        };
      } else {
        input.onmidimessage = null;
      }
    });
  }

  private detachInputListeners(): void {
    if (!this.access) return;
    this.access.inputs.forEach((input) => {
      input.onmidimessage = null;
    });
  }

  private refreshPortBindings(): void {
    if (!this.access) return;
    const outputs = this.getOutputs();
    if (this.selectedOutputId !== null && !outputs.some((o) => o.id === this.selectedOutputId)) {
      this.selectedOutputId = outputs[0]?.id ?? null;
    } else if (this.selectedOutputId === null && !this.outputExplicitlyCleared && outputs.length > 0) {
      this.selectedOutputId = outputs[0].id;
    }
    this.attachInputListeners();
  }
}

export const midiController = new MidiController();
