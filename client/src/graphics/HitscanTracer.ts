import * as PIXI from 'pixi.js'
import { WorldEffect } from '../World'

export class HitscanTracer extends PIXI.Graphics implements WorldEffect {
    private lifetime: number
    private remaining: number
    destroyed: boolean

    constructor(startX: number, startY: number, endX: number, endY: number) {
        console.log('Creating HitscanTracer', startX, startY, endX, endY)
        super()
        this.lifetime = 0.15
        this.remaining = this.lifetime
        this.destroyed = false

        this.setStrokeStyle({ width: 2, color: 0xfff0a6, alpha: 0.9 })
        this.moveTo(startX, startY)
        this.lineTo(endX, endY)
    }

    update(delta: number, _tick?: number, _now?: number) {
        this.remaining -= delta
        const t = Math.max(this.remaining / this.lifetime, 0)
        this.alpha = t

        if (this.remaining <= 0) {
            this.destroyed = true
            this.removeFromParent()
            this.destroy()
        }
    }
}
