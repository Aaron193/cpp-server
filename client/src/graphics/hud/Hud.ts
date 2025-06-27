import * as PIXI from 'pixi.js'
import { HealthBar } from './HealthBar'
import { DebugPanel } from './DebugPanel'
import { Renderer } from '../../Renderer'

export class Hud extends PIXI.Container {
    renderer: Renderer
    healthBar: HealthBar = new HealthBar()
    debugPanel: DebugPanel = new DebugPanel(this)

    constructor(renderer: Renderer) {
        super({
            isRenderGroup: true,
        })

        this.renderer = renderer

        this.addChild(this.healthBar)
        this.addChild(this.debugPanel)
    }

    resize() {
        this.healthBar.resize()
    }

    update(delta: number, tick: number, now: number) {
        this.debugPanel.update(delta, tick, now)
    }
}
