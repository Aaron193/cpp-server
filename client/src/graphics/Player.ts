import * as PIXI from 'pixi.js'
import { NameTag } from './NameTag'
import { GameClient } from '../GameClient'
import { Entity } from './Entity'

export class Player extends Entity {
    nameTag: NameTag
    body: PIXI.Graphics
    name: string = 'Player'
    client: GameClient

    constructor(client: GameClient) {
        super()

        this.client = client
        this.nameTag = new NameTag(this.name)
        this.nameTag.position.set(0, -50)

        this.body = new PIXI.Graphics()
        this.body.circle(0, 0, 25)
        this.body.fill({ color: 0xffffff })
        this.body.tint = 0xff0000

        this.addChild(this.body)
        this.addChild(this.nameTag)

        this.client.world.renderer.foreground.addChild(this)
    }

    update(delta: number) {
        // do some update stuff or whatever
    }
}
