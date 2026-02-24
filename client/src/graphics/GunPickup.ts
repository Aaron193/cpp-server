import * as PIXI from 'pixi.js'
import { ItemType } from '../enums/ItemType'
import { GameClient } from '../GameClient'
import { Entity } from './Entity'

const ITEM_LABELS: Record<number, string> = {
    [ItemType.ITEM_GUN_PISTOL]: 'Pistol',
    [ItemType.ITEM_GUN_RIFLE]: 'Rifle',
    [ItemType.ITEM_GUN_SHOTGUN]: 'Shotgun',
}

export class GunPickup extends Entity {
    client: GameClient

    constructor(client: GameClient, itemType: ItemType, ammoInMag: number) {
        super()

        this.client = client

        const base = new PIXI.Graphics()
        base.circle(0, 0, 22)
        base.fill({ color: 0x1e293b, alpha: 0.9 })
        base.stroke({ color: 0xf59e0b, width: 2 })
        this.addChild(base)

        const label = new PIXI.Text({
            text: ITEM_LABELS[itemType] || 'Gun',
            style: { fill: 0xffffff, fontSize: 11, fontWeight: 'bold' },
        })
        label.anchor.set(0.5, 1.1)
        this.addChild(label)

        const ammoLabel = new PIXI.Text({
            text: `${ammoInMag}`,
            style: { fill: 0xfff3b0, fontSize: 10 },
        })
        ammoLabel.anchor.set(0.5, -0.2)
        this.addChild(ammoLabel)

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
