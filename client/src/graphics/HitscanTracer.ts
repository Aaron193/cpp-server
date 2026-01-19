import * as PIXI from 'pixi.js'
import type { BLEND_MODES } from 'pixi.js'
import { WorldEffect } from '../World'

export class HitscanTracer extends PIXI.Container implements WorldEffect {
    private static readonly LIFETIME = 0.16
    private static readonly CORE_WIDTH = 4
    private static readonly GLOW_WIDTH = 12
    private static readonly STREAK_LENGTH = 128
    private static readonly CORE_COLOR = 0xfff0a6
    private static readonly GLOW_COLOR = 0xffc36b
    private static coreTexture: PIXI.Texture | null = null
    private static glowTexture: PIXI.Texture | null = null

    private lifetime: number
    private remaining: number
    destroyed: boolean

    private coreMesh: PIXI.MeshSimple
    private glowMesh: PIXI.MeshSimple
    private startX: number
    private startY: number
    private endX: number
    private endY: number
    private dirX: number
    private dirY: number
    private totalLength: number

    constructor(startX: number, startY: number, endX: number, endY: number) {
        super()
        this.lifetime = HitscanTracer.LIFETIME
        this.remaining = this.lifetime
        this.destroyed = false

        const dx = endX - startX
        const dy = endY - startY
        let length = Math.hypot(dx, dy)

        if (length < 0.001) {
            length = 0.001
            this.dirX = 1
            this.dirY = 0
        } else {
            this.dirX = dx / length
            this.dirY = dy / length
        }

        this.startX = startX
        this.startY = startY
        this.endX = endX
        this.endY = endY
        this.totalLength = length

        this.coreMesh = HitscanTracer.createStreakMesh(
            startX,
            startY,
            startX,
            startY,
            HitscanTracer.CORE_WIDTH,
            HitscanTracer.getCoreTexture(),
            'normal'
        )

        this.glowMesh = HitscanTracer.createStreakMesh(
            startX,
            startY,
            startX,
            startY,
            HitscanTracer.GLOW_WIDTH,
            HitscanTracer.getGlowTexture(),
            'add'
        )

        this.glowMesh.alpha = 0.8
        this.glowMesh.filters = [
            new PIXI.BlurFilter({ strength: 4, quality: 2, kernelSize: 7 }),
        ]

        this.addChild(this.glowMesh, this.coreMesh)
    }

    update(delta: number, _tick?: number, _now?: number) {
        this.remaining -= delta
        const t = Math.max(this.remaining / this.lifetime, 0)
        this.alpha = t

        const progress = Math.min(Math.max(1 - t, 0), 1)
        const headDist = this.totalLength * progress
        const tailDist = Math.max(0, headDist - HitscanTracer.STREAK_LENGTH)

        const headX = this.startX + this.dirX * headDist
        const headY = this.startY + this.dirY * headDist
        const tailX = this.startX + this.dirX * tailDist
        const tailY = this.startY + this.dirY * tailDist

        HitscanTracer.updateStreakMesh(
            this.coreMesh,
            tailX,
            tailY,
            headX,
            headY,
            HitscanTracer.CORE_WIDTH
        )

        HitscanTracer.updateStreakMesh(
            this.glowMesh,
            tailX,
            tailY,
            headX,
            headY,
            HitscanTracer.GLOW_WIDTH
        )

        if (this.remaining <= 0) {
            this.destroyed = true
            this.removeFromParent()
            this.destroy({ children: true })
        }
    }

    private static getCoreTexture(): PIXI.Texture {
        if (!HitscanTracer.coreTexture) {
            HitscanTracer.coreTexture = HitscanTracer.createGradientTexture(
                256,
                12,
                HitscanTracer.CORE_COLOR,
                0,
                1,
                2.2
            )
        }
        return HitscanTracer.coreTexture
    }

    private static getGlowTexture(): PIXI.Texture {
        if (!HitscanTracer.glowTexture) {
            HitscanTracer.glowTexture = HitscanTracer.createGradientTexture(
                256,
                48,
                HitscanTracer.GLOW_COLOR,
                0,
                0.9,
                1.2
            )
        }
        return HitscanTracer.glowTexture
    }

    private static createStreakMesh(
        startX: number,
        startY: number,
        endX: number,
        endY: number,
        width: number,
        texture: PIXI.Texture,
        blendMode: BLEND_MODES
    ): PIXI.MeshSimple {
        const vertices = new Float32Array([
            startX,
            startY,
            startX,
            startY,
            endX,
            endY,
            endX,
            endY,
        ])
        const uvs = new Float32Array([0, 0, 0, 1, 1, 1, 1, 0])
        const indices = new Uint32Array([0, 1, 2, 0, 2, 3])

        return new PIXI.MeshSimple({
            texture,
            vertices,
            uvs,
            indices,
            blendMode,
        })
    }

    private static updateStreakMesh(
        mesh: PIXI.MeshSimple,
        startX: number,
        startY: number,
        endX: number,
        endY: number,
        width: number
    ) {
        let dx = endX - startX
        let dy = endY - startY
        let length = Math.hypot(dx, dy)

        if (length < 0.001) {
            length = 0.001
            dx = 1
            dy = 0
        }

        const invLen = 1 / length
        const nx = -dy * invLen
        const ny = dx * invLen
        const half = width * 0.5

        const x0 = startX + nx * half
        const y0 = startY + ny * half
        const x1 = startX - nx * half
        const y1 = startY - ny * half
        const x2 = endX - nx * half
        const y2 = endY - ny * half
        const x3 = endX + nx * half
        const y3 = endY + ny * half

        const vertices = mesh.vertices as Float32Array
        vertices[0] = x0
        vertices[1] = y0
        vertices[2] = x1
        vertices[3] = y1
        vertices[4] = x2
        vertices[5] = y2
        vertices[6] = x3
        vertices[7] = y3
    }

    private static createGradientTexture(
        width: number,
        height: number,
        color: number,
        tailAlpha: number,
        headAlpha: number,
        edgePower: number
    ): PIXI.Texture {
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')

        if (!ctx) {
            return PIXI.Texture.WHITE
        }

        const imageData = ctx.createImageData(width, height)
        const data = imageData.data

        const r = (color >> 16) & 0xff
        const g = (color >> 8) & 0xff
        const b = color & 0xff

        for (let y = 0; y < height; y++) {
            const v = Math.abs((y + 0.5) / height - 0.5) * 2
            const edge = Math.max(1 - v, 0)
            const edgeAlpha = Math.pow(edge, edgePower)

            for (let x = 0; x < width; x++) {
                const u = x / (width - 1)
                const along = HitscanTracer.smoothstep(0, 0.85, u)
                const headBoost = HitscanTracer.smoothstep(0.85, 1, u) * 0.15
                const alpha = Math.min(
                    1,
                    (tailAlpha + (headAlpha - tailAlpha) * along + headBoost) *
                        edgeAlpha
                )

                const i = (y * width + x) * 4
                data[i] = r
                data[i + 1] = g
                data[i + 2] = b
                data[i + 3] = Math.round(alpha * 255)
            }
        }

        ctx.putImageData(imageData, 0, 0)
        return PIXI.Texture.from(canvas)
    }

    private static smoothstep(edge0: number, edge1: number, x: number) {
        const t = Math.max(0, Math.min((x - edge0) / (edge1 - edge0), 1))
        return t * t * (3 - 2 * t)
    }
}
