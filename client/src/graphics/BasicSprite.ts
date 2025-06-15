import * as PIXI from 'pixi.js'
import { GameClient } from '../GameClient'
import { Entity } from './Entity'
import { AssetLoader } from './utils/AssetLoader'

export class BasicSprite extends Entity {
    client: GameClient

    constructor(client: GameClient) {
        super()

        this.client = client

        const texture = AssetLoader.getTexture(
            Math.random() > 0.5 ? 'rock' : 'bush'
        )
        const sprite = new PIXI.Sprite(texture)
        sprite.anchor.set(0.5, 0.5)
        this.addChild(sprite)

        this.client.world.renderer.foreground.addChild(this)
    }

    update(delta: number) {
        // do some update stuff or whatever
    }

    setRot(angle: number) {
        this.rotation = angle
    }

    getRot(): number {
        return this.rotation
    }
}
