import * as PIXI from 'pixi.js'
import { GameClient } from '../GameClient'
import { Entity } from './Entity'

export class Crate extends Entity {
    client: GameClient

    constructor(client: GameClient) {
        super()

        this.client = client

        const crate = new PIXI.Sprite(PIXI.Texture.WHITE)
        crate.tint = 0x5e4e2a
        crate.width = 100
        crate.height = 100
        crate.anchor.set(0.5)

        this.addChild(crate)

        this.client.world.renderer.background.addChild(this)
    }

    update(_delta: number) {
        // do some update stuff or whatever
    }

    setRot(angle: number) {
        this.rotation = angle
    }

    getRot(): number {
        return this.rotation
    }
}
