import * as PIXI from 'pixi.js'
import { GameClient } from '../GameClient'
import { Entity } from './Entity'

export class Bullet extends Entity {
    body: PIXI.Graphics
    client: GameClient

    constructor(client: GameClient) {
        super()
        this.interpolate = true
        this.client = client

        this.body = new PIXI.Graphics()
        this.body.circle(0, 0, 2)
        this.body.fill({ color: 0xffe066 })
        this.addChild(this.body)

        this.client.world.renderer.foreground.addChild(this)
    }

    update(_delta: number, _tick: number, _now: number) {
        // Position handled by interpolator snapshots
    }

    setRot(angle: number) {
        this.rotation = angle
    }

    getRot(): number {
        return this.rotation
    }
}
