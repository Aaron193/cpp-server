import * as PIXI from 'pixi.js'

export class HealthBar extends PIXI.Container {
    health: number = 100
    location: {
        width: number
        height: number
        padding: number
    } = {
        width: 200,
        height: 20,
        padding: 20,
    }
    constructor() {
        super()

        const red = new PIXI.Graphics()
        red.clear()
        red.fill({ color: 0x912400 })
        red.rect(0, 0, this.location.width, this.location.height)
        red.fill()

        const green = new PIXI.Graphics()
        green.clear()
        green.fill({ color: 0x00911f })
        green.rect(0, 0, this.location.width, this.location.height)
        green.fill()

        this.x = (window.innerWidth - this.location.width) / 2
        this.y =
            window.innerHeight - this.location.height - this.location.padding

        this.addChild(red)
        this.addChild(green)

        // just for testing
        this.setHealth(75)
    }

    setHealth(health: number) {
        this.health = health
        const green = this.getChildAt(1) as PIXI.Graphics
        green.clear()
        green.fill({ color: 0x00ff00 })
        green.rect(
            0,
            0,
            (this.health / 100) * this.location.width,
            this.location.height
        )
        green.fill()
    }
    resize() {
        this.x = (window.innerWidth - this.width) / 2
        this.y = window.innerHeight - this.height - this.location.padding
    }
}
