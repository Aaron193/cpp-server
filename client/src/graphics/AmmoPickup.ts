import * as PIXI from 'pixi.js'
import { GameClient } from '../GameClient'
import { Entity } from './Entity'

const AMMO_LABELS: Record<number, string> = {
    0: 'Light',
    1: 'Heavy',
    2: 'Shell',
    3: 'Rocket',
}

export class AmmoPickup extends Entity {
    client: GameClient

    constructor(client: GameClient, ammoType: number, amount: number) {
        super()

        this.client = client

        const box = new PIXI.Graphics()
        box.roundRect(-16, -16, 32, 32, 6)
        box.fill({ color: 0x064e3b, alpha: 0.92 })
        box.stroke({ color: 0x34d399, width: 2 })
        this.addChild(box)

        const label = new PIXI.Text({
            text: AMMO_LABELS[ammoType] || 'Ammo',
            style: { fill: 0xffffff, fontSize: 10, fontWeight: 'bold' },
        })
        label.anchor.set(0.5, 1.2)
        this.addChild(label)

        const amountLabel = new PIXI.Text({
            text: `+${amount}`,
            style: { fill: 0xc7f9cc, fontSize: 10 },
        })
        amountLabel.anchor.set(0.5, -0.2)
        this.addChild(amountLabel)

        this.client.world.renderer.foreground.addChild(this)
    }

    update(_delta: number) {}

    setRot(angle: number) {
        this.rotation = angle
    }

    getRot(): number {
        return this.rotation
    }
}
