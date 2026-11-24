import { TelemetryHistory, TelemetryState, TelemetryValue } from './widgets';

export class SimulationController {
  private timer: ReturnType<typeof setInterval> | null = null;
  private frameIndex = 0;
  private state: TelemetryState = {};
  private history: TelemetryHistory = {};
  private controlOverrides = new Set<string>();

  constructor(
    private readonly frames: Record<string, TelemetryValue>[],
    private readonly intervalMs: number,
    private readonly onTick: (
      state: TelemetryState,
      history: TelemetryHistory,
      frameIndex: number
    ) => void
  ) {
    if (this.frames.length) {
      this.applyFrame(this.frames[0]);
    }
  }

  private applyFrame(frame: Record<string, TelemetryValue>): void {
    for (const [k, v] of Object.entries(frame)) {
      if (this.controlOverrides.has(k)) continue;
      this.state[k] = v;
      if (typeof v === 'number' && Number.isFinite(v)) {
        const arr = this.history[k] ? [...this.history[k], v] : [v];
        this.history[k] = arr.slice(-20);
      }
    }
  }

  isRunning(): boolean {
    return this.timer !== null;
  }

  getState(): TelemetryState {
    return { ...this.state };
  }

  getHistory(): TelemetryHistory {
    const out: TelemetryHistory = {};
    for (const [k, arr] of Object.entries(this.history)) {
      out[k] = [...arr];
    }
    return out;
  }

  getFrameIndex(): number {
    return this.frameIndex;
  }

  step(): void {
    if (!this.frames.length) return;
    this.frameIndex = (this.frameIndex + 1) % this.frames.length;
    this.applyFrame(this.frames[this.frameIndex]);
    this.onTick(this.getState(), this.getHistory(), this.frameIndex);
  }

  start(): void {
    if (this.timer !== null || !this.frames.length) return;
    const ms = Math.max(100, this.intervalMs || 1000);
    this.timer = setInterval(() => {
      this.step();
    }, ms);
    this.onTick(this.getState(), this.getHistory(), this.frameIndex);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.onTick(this.getState(), this.getHistory(), this.frameIndex);
  }

  setControlValue(key: string, value: TelemetryValue): void {
    this.controlOverrides.add(key);
    this.state[key] = value;
    if (typeof value === 'number' && Number.isFinite(value)) {
      const arr = this.history[key] ? [...this.history[key], value] : [value];
      this.history[key] = arr.slice(-20);
    }
    this.onTick(this.getState(), this.getHistory(), this.frameIndex);
  }
}
