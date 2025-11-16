import * as PIXI from 'pixi.js'
import { NameTag } from './NameTag'
import { GameClient } from '../GameClient'
import { Entity } from './Entity'
import { Animation, LinearFastInSlowOut, LinearInOut } from './utils/Animation'
import { assert } from '../utils/assert'
import { COLORS, STROKE_WIDTH } from '../utils/constants'
import { ChatContainer } from './ChatContainer'

export const Nicknames = new Map<number, string>()

enum STATE {
    IDLE = 0,
    MELEE = 1 << 0,
    HURT = 1 << 1,
}

export class Player extends Entity {
    nameTag: NameTag
    body: PIXI.Graphics
    leftHand: PIXI.Graphics
    rightHand: PIXI.Graphics
    chatContainer: ChatContainer = new ChatContainer()

    client: GameClient

    melee: Animation = new Animation(
        LinearFastInSlowOut,
        (1 / 3) * 0.95, // cooldown is 1/3 of a second, make sure animation finishes before server cooldown by * 0.95
        Math.PI / 3
    )

    hurt: Animation = new Animation(LinearInOut, 0.2, 1)

    handToggle: boolean = false

    constructor(client: GameClient, { id }: { id: number }) {
        super()

        this.interpolate = true
        this._id = id

        this.client = client

        assert(Nicknames.has(this._id), `No nickname for player ${this._id}`)
        this.nameTag = new NameTag(Nicknames.get(this._id))
        this.nameTag.position.set(0, -50)

        this.body = new PIXI.Graphics()
        this.body.circle(0, 0, 25)
        this.body.fill({ color: 0xba9a50 })
        this.body.stroke({
            width: STROKE_WIDTH,
            color: COLORS.STROKE,
            alignment: 0,
        })

        this.leftHand = new PIXI.Graphics()
        this.leftHand.circle(
            Math.cos(-Math.PI / 4) * 25,
            Math.sin(-Math.PI / 4) * 25,
            7
        )
        this.leftHand.fill({ color: 0xba9a50 })
        this.leftHand.stroke({
            width: STROKE_WIDTH,
            color: COLORS.STROKE,
            alignment: 0,
        })

        this.rightHand = new PIXI.Graphics()
        this.rightHand.circle(
            Math.cos(Math.PI / 4) * 25,
            Math.sin(Math.PI / 4) * 25,
            7
        )
        this.rightHand.fill({ color: 0xba9a50 })
        this.rightHand.stroke({
            width: STROKE_WIDTH,
            color: COLORS.STROKE,
            alignment: 0,
        })

        this.addChild(this.body)
        this.body.addChild(this.leftHand)
        this.body.addChild(this.rightHand)
        this.addChild(this.nameTag)

        // Chat renders above nametag
        this.chatContainer.position.set(0, -80)
        this.addChild(this.chatContainer)

        this.client.world.renderer.middleground.addChild(this)
    }

    getAngleToMouse(): number {
        const pos = this.client.world.renderer.toWorldCoordinates(
            this.client.mouseX,
            this.client.mouseY
        )

        const dx = pos.x - this.position.x
        const dy = pos.y - this.position.y

        return Math.atan2(dy, dx)
    }

    update(delta: number, _tick: number, _now: number) {
        const cameraEntityId = this.client.world.cameraEntityId

        if (this._id === cameraEntityId && this.client.world.active) {
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

        if (this._state & STATE.HURT) {
            const finished = this.hurt.update(delta)

            const intensity = this.hurt.current
            const lerp = (a: number, b: number, t: number) =>
                (((a & 0xff0000) + ((b & 0xff0000) - (a & 0xff0000)) * t) &
                    0xff0000) |
                (((a & 0x00ff00) + ((b & 0x00ff00) - (a & 0x00ff00)) * t) &
                    0x00ff00) |
                (((a & 0x0000ff) + ((b & 0x0000ff) - (a & 0x0000ff)) * t) &
                    0x0000ff)

            const originalColor = 0xba9a50
            const hurtColor = 0xff0000
            const lerpedColor = lerp(originalColor, hurtColor, intensity)

            // Redraw body with new color instead of using tint
            this.body.clear()
            this.body.circle(0, 0, 25)
            this.body.fill({ color: lerpedColor })
            this.body.stroke({
                width: STROKE_WIDTH,
                color: COLORS.STROKE,
                alignment: 0,
            })

            if (finished) {
                this.hurt.reset()
                // Redraw with original color
                this.body.clear()
                this.body.circle(0, 0, 25)
                this.body.fill({ color: originalColor })
                this.body.stroke({
                    width: STROKE_WIDTH,
                    color: COLORS.STROKE,
                    alignment: 0,
                })
                this._state &= ~STATE.HURT
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

        this.chatContainer.update(delta)
    }

    receivedChat(message: string) {
        this.chatContainer.addMessage(message)
    }

    setRot(angle: number) {
        this.body.rotation = angle
    }

    getRot(): number {
        return this.body.rotation
    }
}
