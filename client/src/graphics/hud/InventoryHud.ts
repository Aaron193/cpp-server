import * as PIXI from 'pixi.js'
import { Renderer } from '../../Renderer'
import { ItemType } from '../../enums/ItemType'

export class InventoryHud extends PIXI.Container {
    renderer: Renderer
    slots: PIXI.Graphics[] = []
    labels: PIXI.Text[] = []

    constructor(renderer: Renderer) {
        super()
        this.renderer = renderer

        for (let i = 0; i < 5; i++) {
            const slot = new PIXI.Graphics()
            this.slots.push(slot)
            this.addChild(slot)

            const label = new PIXI.Text({
                text: '',
                style: { fill: 0xffffff, fontSize: 12 },
            })
            this.labels.push(label)
            this.addChild(label)
        }

        this.resize()
    }

    resize() {
        const totalWidth = 5 * 52 + 4 * 6
        const startX = (this.renderer.renderer.screen.width - totalWidth) / 2
        const y = this.renderer.renderer.screen.height - 64

        for (let i = 0; i < 5; i++) {
            const x = startX + i * 58
            const slot = this.slots[i]
            const label = this.labels[i]

            slot.position.set(x, y)
            label.position.set(x + 6, y + 30)
        }
    }

    update(activeSlot: number, types: ItemType[]) {
        for (let i = 0; i < 5; i++) {
            const slot = this.slots[i]
            slot.clear()

            slot.setStrokeStyle({
                width: 2,
                color: i === activeSlot ? 0xffe066 : 0x333333,
            })
            slot.fill({ color: 0x111111, alpha: 0.6 })
            slot.roundRect(0, 0, 52, 40, 6)
            slot.fill()

            const label = this.labels[i]
            label.text = this.getLabel(types[i])
        }
    }

    private getLabel(type: ItemType): string {
        switch (type) {
            case ItemType.ITEM_GUN_PISTOL:
                return 'Pistol'
            case ItemType.ITEM_GUN_RIFLE:
                return 'Rifle'
            case ItemType.ITEM_GUN_SHOTGUN:
                return 'Shotgun'
            default:
                return ''
        }
    }
}
