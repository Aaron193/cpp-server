import * as PIXI from 'pixi.js'
import { GameClient } from '../GameClient'
import { Entity } from './Entity'
import { AssetLoader } from './utils/AssetLoader'

export class BasicSprite extends Entity {
    client: GameClient
    shadow: PIXI.Sprite
    sprite: PIXI.Sprite

    constructor(client: GameClient, texture: PIXI.Texture) {
        super()

        this.client = client

        this.sprite = new PIXI.Sprite(texture)
        this.shadow = new PIXI.Sprite(texture)
        this.shadow.scale.set(0.5, 0.5)
        this.shadow.anchor.set(0.5, 0.5)
        this.shadow.tint = 0x000000
        this.shadow.alpha = 0.3
        this.shadow.position.y = 15

        this.sprite = new PIXI.Sprite(texture)
        this.sprite.scale.set(0.5, 0.5)
        this.sprite.anchor.set(0.5, 0.5)

        this.addChild(this.shadow)
        this.addChild(this.sprite)

        this.client.world.renderer.foreground.addChild(this)
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
