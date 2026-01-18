import * as PIXI from 'pixi.js'
import { HealthBar } from './HealthBar'
import { DebugPanel } from './DebugPanel'
import { NewsFeed } from './NewsFeed'
import { Minimap } from './Minimap'
import { Renderer } from '../../Renderer'
import { InventoryHud } from './InventoryHud'
import { AmmoCounter } from './AmmoCounter'
import { ItemType } from '../../enums/ItemType'

export class Hud extends PIXI.Container {
    renderer: Renderer
    healthBar: HealthBar = new HealthBar()
    debugPanel: DebugPanel = new DebugPanel(this)
    newsFeed: NewsFeed = new NewsFeed()
    minimap: Minimap
    inventoryHud: InventoryHud
    ammoCounter: AmmoCounter

    constructor(renderer: Renderer) {
        super({
            isRenderGroup: true,
        })

        this.renderer = renderer
        this.minimap = new Minimap(renderer)
        this.inventoryHud = new InventoryHud(renderer)
        this.ammoCounter = new AmmoCounter(renderer)

        this.addChild(this.healthBar)
        this.addChild(this.debugPanel)
        this.addChild(this.newsFeed)
        this.addChild(this.minimap)
        this.addChild(this.inventoryHud)
        this.addChild(this.ammoCounter)
        this.resize()
    }

    resize() {
        this.healthBar.resize()
        this.debugPanel.resize()
        this.newsFeed.resize()
        this.minimap.resize()
        this.inventoryHud.resize()
        this.ammoCounter.resize()
    }

    update(delta: number, tick: number, now: number) {
        // this.alpha = +this.renderer.world.isControllingPlayer()
        this.debugPanel.update(delta, tick, now)
        this.newsFeed.update(delta, tick, now)
        this.minimap.update(delta, tick, now)

        const world = this.renderer.world
        const types = world.inventorySlots.map((slot) => slot.type as ItemType)
        this.inventoryHud.update(world.activeSlot, types)
        this.ammoCounter.update(
            world.activeAmmoInMag,
            world.activeAmmoReserve,
            world.activeReloadRemaining
        )
    }
}
