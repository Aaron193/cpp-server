import * as PIXI from 'pixi.js'
import { COLORS, STROKE_WIDTH } from '../../utils/constants'

export class HealthBar extends PIXI.Container {
    health: number = 1
    location: {
        width: number
        height: number
        padding: number
    } = {
        width: 200,
        height: 25,
        padding: 5,
    }
    constructor() {
        super()

        const borderRadius = 6

        const red = new PIXI.Graphics()
        red.fill({ color: 0x912400 })
        red.roundRect(
            0,
            0,
            this.location.width,
            this.location.height,
            borderRadius
        )
        red.fill()

        const green = new PIXI.Graphics()
        green.fill({ color: 0x00911f })
        green.roundRect(
            0,
            0,
            this.location.width,
            this.location.height,
            borderRadius
        )
        green.fill()

        // Create separate border graphics for clean stroke
        const border = new PIXI.Graphics()
        border.stroke({
            width: STROKE_WIDTH,
            color: COLORS.STROKE,
            alpha: 1,
            join: 'round',
        })
        border.roundRect(
            0,
            0,
            this.location.width,
            this.location.height,
            borderRadius
        )
        border.stroke()

        this.x = (window.innerWidth - this.location.width) / 2
        this.y =
            window.innerHeight - this.location.height - this.location.padding

        this.addChild(red)
        this.addChild(green)
        this.addChild(border)
    }

    setHealth(health: number) {
        this.health = health
        const green = this.getChildAt(1) as PIXI.Graphics
        green.clear()
        green.fill({ color: 0x00911f })
        green.rect(
            0,
            0,
            this.health * this.location.width,
            this.location.height
        )
        green.fill()
    }
    resize() {
        this.x = (window.innerWidth - this.width) / 2
        this.y = window.innerHeight - this.height - this.location.padding
    }
}
