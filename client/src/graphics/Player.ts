import * as PIXI from 'pixi.js'
import { NameTag } from './NameTag'
import { GameClient } from '../GameClient'
import { Entity } from './Entity'

export const Nicknames = new Map<number, string>()

export class Player extends Entity {
    nameTag: NameTag
    body: PIXI.Graphics
    leftHand: PIXI.Graphics
    rightHand: PIXI.Graphics
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
        this.body.tint = 0xba9a50
        this.body.stroke({ width: 3, color: 0x000000, alignment: 0 })

        this.leftHand = new PIXI.Graphics()
        this.leftHand.circle(
            Math.cos(-Math.PI / 4) * 25,
            Math.sin(-Math.PI / 4) * 25,
            7
        )
        this.leftHand.fill({ color: 0xffffff })
        this.leftHand.stroke({ width: 3, color: 0x000000, alignment: 0 })

        this.rightHand = new PIXI.Graphics()
        this.rightHand.circle(
            Math.cos(Math.PI / 4) * 25,
            Math.sin(Math.PI / 4) * 25,
            7
        )
        this.rightHand.fill({ color: 0xffffff })
        this.rightHand.stroke({ width: 3, color: 0x000000, alignment: 0 })

        this.addChild(this.body)
        this.body.addChild(this.leftHand)
        this.body.addChild(this.rightHand)
        this.addChild(this.nameTag)

        this.client.world.renderer.foreground.addChild(this)
    }

    update(delta: number, tick: number, now: number) {
        // do some update stuff or whatever
        const myEntityId = this.client.world.myEntityId

        if (this._id === myEntityId) {
            const mouseWorldPosition =
                this.client.world.renderer.toWorldCoordinates(
                    this.client.mouseX,
                    this.client.mouseY
                )

            const dx = mouseWorldPosition.x - this.position.x
            const dy = mouseWorldPosition.y - this.position.y

            this.body.rotation = Math.atan2(dy, dx)
        }

        //
    }

    setRot(angle: number) {
        this.body.rotation = angle
    }
}
