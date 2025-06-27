import * as PIXI from 'pixi.js'
import { GameClient } from '../GameClient'
import { Entity } from './Entity'
import { AssetLoader } from './utils/AssetLoader'

export class BasicSprite extends Entity {
    client: GameClient

    constructor(client: GameClient) {
        super()

        this.client = client

        const sprites = ['bush_1', 'bush_2', 'rock_1', 'rock_2']
        const texture = AssetLoader.getTexture(
            sprites[Math.floor(Math.random() * sprites.length)]
        )

        const sprite = new PIXI.Sprite(texture)

        // images are upscaled by default for shaper images
        sprite.scale.set(0.5, 0.5)
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
