type EasingFunction = (t: number) => number

export class Animation {
    easingFunction: EasingFunction
    duration: number
    elapsedTime: number = 0
    amplitude: number
    current: number = 0

    constructor(func: EasingFunction, duration: number, amplitude: number) {
        this.easingFunction = func
        this.duration = duration
        this.amplitude = amplitude
    }

    update(delta: number): boolean {
        this.elapsedTime += delta
        if (this.elapsedTime >= this.duration) {
            this.current = this.amplitude * this.easingFunction(1)
            return true
        } else {
            const progress = this.elapsedTime / this.duration
            this.current = this.amplitude * this.easingFunction(progress)
            return false
        }
    }

    reset() {
        this.elapsedTime = 0
        this.current = 0
    }

    finish() {
        this.elapsedTime = this.duration
        this.current = this.amplitude * this.easingFunction(1)
    }
}

export const LinearFastInSlowOut = (t: number) =>
    t < 1 / 3 ? 3 * t : 1.5 - 1.5 * t
export const LinearInOut = (t: number) => (t < 0.5 ? t : 1 - t)
