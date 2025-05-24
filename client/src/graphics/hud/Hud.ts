import * as PIXI from 'pixi.js'
import { HealthBar } from './HealthBar'

export class Hud extends PIXI.Container {
    healthBar: HealthBar = new HealthBar()

    constructor() {
        super()

        this.addChild(this.healthBar)
    }

    resize() {
        this.healthBar.resize()
    }
}
