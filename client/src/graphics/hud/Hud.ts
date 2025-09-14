import * as PIXI from 'pixi.js'
import { HealthBar } from './HealthBar'
import { DebugPanel } from './DebugPanel'
import { NewsFeed } from './NewsFeed'
import { Renderer } from '../../Renderer'

export class Hud extends PIXI.Container {
    renderer: Renderer
    healthBar: HealthBar = new HealthBar()
    debugPanel: DebugPanel = new DebugPanel(this)
    newsFeed: NewsFeed = new NewsFeed()

    constructor(renderer: Renderer) {
        super({
            isRenderGroup: true,
        })

        this.renderer = renderer

        this.addChild(this.healthBar)
        this.addChild(this.debugPanel)
        this.addChild(this.newsFeed)
    }

    resize() {
        this.healthBar.resize()
        this.newsFeed.resize()
    }

    update(delta: number, tick: number, now: number) {
        this.debugPanel.update(delta, tick, now)
        this.newsFeed.update(delta, tick, now)
    }
}
