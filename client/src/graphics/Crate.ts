import * as PIXI from 'pixi.js'
import { NameTag } from './NameTag'
import { GameClient } from '../GameClient'
import { Entity } from './Entity'

export class Crate extends Entity {
    client: GameClient

    constructor(client: GameClient) {
        super()

        this.client = client

        const crate = new PIXI.Sprite(PIXI.Texture.WHITE)
        crate.tint = 0x8b4513
        crate.width = 100
        crate.height = 100
        crate.anchor.set(0.5)

        this.addChild(crate)

        this.client.world.renderer.foreground.addChild(this)
    }

    update(delta: number) {
        // do some update stuff or whatever
    }
}
