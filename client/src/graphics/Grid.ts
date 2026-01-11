import * as PIXI from 'pixi.js'
import { Renderer } from '../Renderer'

export class Grid extends PIXI.Graphics {
    renderer: Renderer
    gridSize: number = 64
    gridColor: number = 0x000000
    gridAlpha: number = 0.1
    lineWidth: number = 5

    constructor(renderer: Renderer) {
        super()
        this.renderer = renderer
    }

    update(_delta: number, _tick: number, _now: number) {
        // PIXI renderer
        const renderer = this.renderer.renderer

        const cameraX = this.renderer.camera.x
        const cameraY = this.renderer.camera.y

        // Clear previous grid
        this.clear()

        const worldCameraX = -cameraX + renderer.screen.width / 2
        const worldCameraY = -cameraY + renderer.screen.height / 2

        const padding = this.gridSize
        const leftBound = worldCameraX - renderer.screen.width / 2 - padding
        const rightBound = worldCameraX + renderer.screen.width / 2 + padding
        const topBound = worldCameraY - renderer.screen.height / 2 - padding
        const bottomBound = worldCameraY + renderer.screen.height / 2 + padding

        const startX = Math.floor(leftBound / this.gridSize) * this.gridSize
        const startY = Math.floor(topBound / this.gridSize) * this.gridSize

        this.stroke({
            width: this.lineWidth,
            color: this.gridColor,
            alpha: this.gridAlpha,
        })

        // Vertical lines
        for (let x = startX; x <= rightBound; x += this.gridSize) {
            this.moveTo(x, topBound)
            this.lineTo(x, bottomBound)
        }

        // Horizontal lines
        for (let y = startY; y <= bottomBound; y += this.gridSize) {
            this.moveTo(leftBound, y)
            this.lineTo(rightBound, y)
        }

        this.stroke()
    }
}
