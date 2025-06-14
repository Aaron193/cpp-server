import * as PIXI from 'pixi.js'
import { Renderer } from '../../Renderer'
import { Hud } from './Hud'

export class DebugPanel extends PIXI.Container {
    hud: Hud
    panel: PIXI.Text
    constructor(hud: Hud) {
        super()

        this.hud = hud

        this.panel = new PIXI.Text({
            text: 'Fps \nNew line',
            style: new PIXI.TextStyle({
                fontFamily: 'Arial',
                fontSize: 18,
                fill: 0xffffff,
            }),
        })

        this.position.set(15, 15)

        this.addChild(this.panel)
    }

    update(delta: number, tick: number, now: number) {
        const world = this.hud.renderer.world

        if (world.entities.has(world.cameraEntityId)) {
            const myEntity = world.entities.get(world.cameraEntityId)!
            this.panel.text = `X: ${myEntity._x.toFixed(
                2
            )} Y: ${myEntity._y.toFixed(2)}`
        } else {
            console.log('my entity does not exist')
        }
    }
}
