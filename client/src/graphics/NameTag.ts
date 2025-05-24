import * as PIXI from 'pixi.js'

export class NameTag extends PIXI.Container {
    name: string = 'Player'
    nameTag: PIXI.Text

    constructor(name: string = 'Player') {
        super()
        this.name = name
        this.nameTag = new PIXI.Text({
            text: this.name,
            style: new PIXI.TextStyle({
                fontFamily: 'Arial',
                fontSize: 18,
                fill: 0xffffff,
                align: 'center',
            }),
        })

        this.nameTag.anchor.set(0.5, 0.5)

        this.addChild(this.nameTag)
    }

    update(delta: number) {}
}
