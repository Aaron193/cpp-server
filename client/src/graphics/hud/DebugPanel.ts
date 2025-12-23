import * as PIXI from 'pixi.js'
import { Hud } from './Hud'

export class DebugPanel extends PIXI.Container {
    hud: Hud
    panel: PIXI.Text
    constructor(hud: Hud) {
        super()

        this.hud = hud

        this.panel = new PIXI.Text({
            text: '',
            style: new PIXI.TextStyle({
                fontFamily: 'Arial',
                fontSize: 18,
                fill: 0xffffff,
            }),
        })

        this.addChild(this.panel)
        this.resize()
    }

    resize(): void {
        const padding = 15
        this.position.set(
            padding,
            window.innerHeight - this.panel.height - padding
        )
    }

    update(_delta: number, _tick: number, _now: number) {
        const world = this.hud.renderer.world

        if (world.entities.has(world.cameraEntityId)) {
            const myEntity = world.entities.get(world.cameraEntityId)!
            
            let debugText = `X: ${myEntity._x.toFixed(2)} Y: ${myEntity._y.toFixed(2)}`
            
            // Add terrain info if available
            if (world.terrainGenerator) {
                const tileX = Math.floor(myEntity._x / 64)
                const tileY = Math.floor(myEntity._y / 64)
                const tile = world.terrainGenerator.getTile(tileX, tileY)
                
                if (tile) {
                    const biomeNames = ['Ocean', 'Beach', 'Plains', 'Forest', 'Desert', 'Snow', 'Mountain', 'Swamp']
                    debugText += `\nTile: ${tileX},${tileY} | Biome: ${biomeNames[tile.biome]} | Height: ${tile.height}`
                    if (tile.isWater) {
                        debugText += ' [WATER]'
                    }
                }
            }
            
            this.panel.text = debugText
        } else {
            console.log('my entity does not exist')
        }
    }
}
