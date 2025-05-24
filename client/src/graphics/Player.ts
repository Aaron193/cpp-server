import * as PIXI from 'pixi.js'
import { NameTag } from './NameTag'
import { GameClient } from '../GameClient'
import { Entity } from './Entity'

export const Nicknames = new Map<number, string>()

export class Player extends Entity {
    nameTag: NameTag
    body: PIXI.Graphics
    client: GameClient

    constructor(client: GameClient, { id }: { id: number }) {
        super()

        this.interpolate = true
        this._id = id

        this.client = client
        this.nameTag = new NameTag(Nicknames.get(this._id) || '')
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
