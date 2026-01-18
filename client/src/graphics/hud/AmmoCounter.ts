import * as PIXI from 'pixi.js'
import { Renderer } from '../../Renderer'

export class AmmoCounter extends PIXI.Container {
    renderer: Renderer
    text: PIXI.Text
    reloadText: PIXI.Text

    constructor(renderer: Renderer) {
        super()
        this.renderer = renderer

        this.text = new PIXI.Text({
            text: '',
            style: { fill: 0xffffff, fontSize: 16, fontWeight: 'bold' },
        })
        this.reloadText = new PIXI.Text({
            text: '',
            style: { fill: 0xffe066, fontSize: 12 },
        })

        this.addChild(this.text)
        this.addChild(this.reloadText)
        this.resize()
    }

    resize() {
        const x = this.renderer.renderer.screen.width - 200
        const y = this.renderer.renderer.screen.height - 80
        this.text.position.set(x, y)
        this.reloadText.position.set(x, y + 20)
    }

    update(ammoInMag: number, ammoReserve: number, reloadRemaining: number) {
        if (ammoInMag === 0 && ammoReserve === 0) {
            this.text.text = ''
            this.reloadText.text = ''
            return
        }

        this.text.text = `Ammo: ${ammoInMag}/${ammoReserve}`
        this.reloadText.text = reloadRemaining > 0 ? 'Reloading...' : ''
    }
}
