import * as PIXI from 'pixi.js'
import { COLORS, STROKE_WIDTH } from '../utils/constants'

export class ChatBubble extends PIXI.Container {
    private background: PIXI.Graphics
    private text: PIXI.Text
    private padding: number = 8

    constructor() {
        super()

        this.background = new PIXI.Graphics()
        this.text = new PIXI.Text({
            text: '',
            style: new PIXI.TextStyle({
                fontFamily: 'Arial',
                fontSize: 14,
                fill: 0xffffff,
                align: 'center',
            }),
        })

        this.text.anchor.set(0.5, 0.5)

        this.addChild(this.background)
        this.addChild(this.text)
    }

    setMessage(message: string, opacity: number = 1) {
        this.text.text = message

        const textBounds = this.text.getBounds()
        const bubbleWidth = textBounds.width + this.padding * 2
        const bubbleHeight = textBounds.height + this.padding * 2

        this.background.clear()
        this.background.roundRect(
            -bubbleWidth / 2,
            -bubbleHeight / 2,
            bubbleWidth,
            bubbleHeight,
            8
        )
        this.background.fill({ color: COLORS.STROKE, alpha: opacity })

        this.text.alpha = opacity
    }

    hide() {
        this.visible = false
    }

    show() {
        this.visible = true
    }
}
