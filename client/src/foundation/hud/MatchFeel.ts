export interface MatchFeelSnapshot { readonly countdownBeat: number; readonly countdownScale: number; readonly hitOpacity: number; readonly resourceFlash: number; readonly killOpacity: number }
export class MatchFeelClock {
    private hitAtMs = -Infinity; private resourceAtMs = -Infinity; private killAtMs = -Infinity
    hit(nowMs: number): void { this.hitAtMs = nowMs }
    resource(nowMs: number): void { this.resourceAtMs = nowMs }
    kill(nowMs: number): void { this.killAtMs = nowMs }
    sample(nowMs: number, countdownSeconds: number): MatchFeelSnapshot { const pulse = (at: number, duration: number) => Math.max(0, 1 - (nowMs - at) / duration); const beat = Math.max(0, Math.ceil(countdownSeconds)); const fraction = countdownSeconds - Math.floor(countdownSeconds); return { countdownBeat: beat, countdownScale: beat > 0 && beat <= 5 ? 1 + .18 * (1 - fraction) : 1, hitOpacity: pulse(this.hitAtMs, 150), resourceFlash: pulse(this.resourceAtMs, 380), killOpacity: pulse(this.killAtMs, 700) } }
    reset(): void { this.hitAtMs = this.resourceAtMs = this.killAtMs = -Infinity }
}
