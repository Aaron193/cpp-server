import * as PIXI from 'pixi.js'
import type { BLEND_MODES } from 'pixi.js'
import { GameClient } from '../GameClient'
import { Entity } from './Entity'

const EPSILON = 0.0001

export class Bullet extends Entity {
    private static readonly CORE_WIDTH = 4
    private static readonly GLOW_WIDTH = 12
    private static readonly STREAK_LENGTH = 128
    private static readonly MIN_STREAK_LENGTH = 16
    private static readonly CORE_COLOR = 0xfff0a6
    private static readonly GLOW_COLOR = 0xffc36b
    private static coreTexture: PIXI.Texture | null = null
    private static glowTexture: PIXI.Texture | null = null

    client: GameClient
    private coreMesh: PIXI.MeshSimple
    private glowMesh: PIXI.MeshSimple
    private lastX: number | null = null
    private lastY: number | null = null
    private velocityX: number = 0
    private velocityY: number = 0

    constructor(client: GameClient) {
        super()
        this.interpolate = false
        this.client = client

        this.coreMesh = Bullet.createStreakMesh(
            0,
            0,
            0,
            0,
            Bullet.CORE_WIDTH,
            Bullet.getCoreTexture(),
            'normal'
        )

        this.glowMesh = Bullet.createStreakMesh(
            0,
            0,
            0,
            0,
            Bullet.GLOW_WIDTH,
            Bullet.getGlowTexture(),
            'add'
        )

        this.glowMesh.alpha = 0.8
        this.glowMesh.filters = [
            new PIXI.BlurFilter({ strength: 4, quality: 2, kernelSize: 7 }),
        ]

        this.addChild(this.glowMesh, this.coreMesh)

        this.client.world.renderer.foreground.addChild(this)
    }

    update(delta: number, _tick: number, _now: number) {
        this.position.x += this.velocityX * delta
        this.position.y += this.velocityY * delta

        const currentX = this.position.x
        const currentY = this.position.y

        if (this.lastX === null || this.lastY === null) {
            this.lastX = currentX
            this.lastY = currentY
            return
        }

        let dx = currentX - this.lastX
        let dy = currentY - this.lastY
        let length = Math.hypot(dx, dy)

        if (length < 0.001) {
            dx = Math.cos(this.rotation)
            dy = Math.sin(this.rotation)
            length = Math.hypot(dx, dy)
        }

        if (length < 0.001) {
            dx = 1
            dy = 0
            length = 1
        }

        const invLen = 1 / length
        const dirX = dx * invLen
        const dirY = dy * invLen

        const streakLength = Math.min(
            Bullet.STREAK_LENGTH,
            Math.max(Bullet.MIN_STREAK_LENGTH, length * 1.5)
        )

        const headX = 0
        const headY = 0
        const tailX = -dirX * streakLength
        const tailY = -dirY * streakLength

        Bullet.updateStreakMesh(
            this.coreMesh,
            tailX,
            tailY,
            headX,
            headY,
            Bullet.CORE_WIDTH
        )

        Bullet.updateStreakMesh(
            this.glowMesh,
            tailX,
            tailY,
            headX,
            headY,
            Bullet.GLOW_WIDTH
        )

        this.lastX = currentX
        this.lastY = currentY
    }

    setRot(angle: number) {
        this.rotation = angle
    }

    setMotion(dirX: number, dirY: number, speed: number) {
        this.velocityX = dirX * speed
        this.velocityY = dirY * speed
        if (Math.abs(dirX) > EPSILON || Math.abs(dirY) > EPSILON) {
            this.rotation = Math.atan2(dirY, dirX)
        }
    }

    getRot(): number {
        return this.rotation
    }

    private static getCoreTexture(): PIXI.Texture {
        if (!Bullet.coreTexture) {
            Bullet.coreTexture = Bullet.createGradientTexture(
                256,
                12,
                Bullet.CORE_COLOR,
                0,
                1,
                2.2
            )
        }
        return Bullet.coreTexture
    }

    private static getGlowTexture(): PIXI.Texture {
        if (!Bullet.glowTexture) {
            Bullet.glowTexture = Bullet.createGradientTexture(
                256,
                48,
                Bullet.GLOW_COLOR,
                0,
                0.9,
                1.2
            )
        }
        return Bullet.glowTexture
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
                const along = Bullet.smoothstep(0, 0.85, u)
                const headBoost = Bullet.smoothstep(0.85, 1, u) * 0.15
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
