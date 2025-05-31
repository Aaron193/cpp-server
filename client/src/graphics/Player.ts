import * as PIXI from 'pixi.js'
import { NameTag } from './NameTag'
import { GameClient } from '../GameClient'
import { Entity } from './Entity'
import { Animation, LinearFastInSlowOut } from './utils/Animation'

export const Nicknames = new Map<number, string>()

enum STATE {
    MELEE = 1 << 0,
}

const TEMP_VEC: { x: number; y: number } = { x: 0, y: 0 }

export class Player extends Entity {
    nameTag: NameTag
    body: PIXI.Graphics
    leftHand: PIXI.Graphics
    rightHand: PIXI.Graphics
    client: GameClient

    melee: Animation = new Animation(
        LinearFastInSlowOut,
        (1 / 3) * 0.95, // cooldown is 1/3 of a second, make sure animation finishes before server cooldown by * 0.95
        Math.PI / 3
    )
    handToggle: boolean = false

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

    getAngleToMouse(): number {
        this.client.world.renderer.toWorldCoordinates(
            this.client.mouseX,
            this.client.mouseY,
            TEMP_VEC
        )

        const dx = TEMP_VEC.x - this.position.x
        const dy = TEMP_VEC.y - this.position.y

        return Math.atan2(dy, dx)
    }

    update(delta: number, tick: number, now: number) {
        // do some update stuff or whatever
        const myEntityId = this.client.world.myEntityId

        if (this._id === myEntityId) {
            this.body.rotation = this.getAngleToMouse()
        }

        if (this._state & STATE.MELEE) {
            const finished = this.melee.update(delta)
            if (finished) {
                this.handToggle = !this.handToggle
                this._state &= ~STATE.MELEE
                this.melee.reset()
            }
        }

        const rightHandRotation = this.handToggle
            ? -this.melee.current
            : this.melee.current / 3
        const leftHandRotation = this.handToggle
            ? -this.melee.current / 3
            : this.melee.current

        const extension =
            this._state & STATE.MELEE ? this.melee.current * 15 : 0

        const rightExtension = this.handToggle ? extension : 0
        const leftExtension = this.handToggle ? 0 : extension

        this.rightHand.position.set(
            Math.cos(Math.PI / 4) * rightExtension,
            Math.sin(Math.PI / 4) * rightExtension
        )
        this.leftHand.position.set(
            Math.cos(-Math.PI / 4) * leftExtension,
            Math.sin(-Math.PI / 4) * leftExtension
        )

        this.rightHand.rotation = rightHandRotation
        this.leftHand.rotation = leftHandRotation
    }

    setRot(angle: number) {
        this.body.rotation = angle
    }
}
