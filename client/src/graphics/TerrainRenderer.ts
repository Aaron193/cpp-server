import * as PIXI from 'pixi.js'
import { BiomeType } from '../enums/BiomeType'
import { Renderer } from '../Renderer'
import { assert } from '../utils/assert'

const debug = false

export class TerrainRenderer {
    private renderer: Renderer
    private container: PIXI.Container
    private meshes: Map<number, PIXI.Graphics> = new Map()

    constructor(renderer: Renderer) {
        this.renderer = renderer
        this.container = new PIXI.Container()
        this.container.zIndex = -1000 // Render behind everything
    }

    getContainer(): PIXI.Container {
        return this.container
    }

    addTerrainMesh(
        id: number,
        biome: BiomeType,
        vertices: { x: number; y: number }[],
        indices: number[]
    ): void {
        // Don't recreate if already exists
        assert(
            !this.meshes.has(id),
            `Terrain mesh with id ${id} already exists.`
        )

        const graphics = new PIXI.Graphics()
        const color = TerrainRenderer.getBiomeColor(biome)

        // Draw triangles
        for (let i = 0; i < indices.length; i += 3) {
            const idx0 = indices[i]
            const idx1 = indices[i + 1]
            const idx2 = indices[i + 2]

            const v0 = vertices[idx0]
            const v1 = vertices[idx1]
            const v2 = vertices[idx2]

            graphics.poly([v0.x, v0.y, v1.x, v1.y, v2.x, v2.y])
            graphics.fill({ color, alpha: 1.0 })
            if (debug) {
                graphics.stroke({ color: 0xff0000, width: 2 })
            }
        }

        // graphics.zIndex = id // todo: check if this is needed
        this.container.addChild(graphics)
        // this.container.sortChildren()
        this.meshes.set(id, graphics)

        // Add terrain to minimap
        const minimap = this.renderer.hud.minimap
        minimap.addTerrainMesh(biome, vertices, indices)
    }

    static getBiomeColor(biome: BiomeType): number {
        switch (biome) {
            case BiomeType.BIOME_DEEP_WATER:
                return 0x142864 // Dark blue
            case BiomeType.BIOME_SHALLOW_WATER:
                return 0x3c6eb4 // Light blue
            case BiomeType.BIOME_BEACH:
                return 0xdcc896 // Sandy beach
            case BiomeType.BIOME_GRASSLAND:
                return 0x78b450 // Green grass
            case BiomeType.BIOME_FOREST:
                return 0x3c7832 // Dark green
            case BiomeType.BIOME_MOUNTAIN:
                return 0x8c8278 // Brown mountain
            case BiomeType.BIOME_PEAK:
                return 0xe8e8e8 // Light gray peak
            default:
                return TerrainRenderer.getBiomeColor(BiomeType.BIOME_DEEP_WATER) // Default to deep water
        }
    }

    clear(): void {
        this.meshes.forEach((graphics) => {
            graphics.destroy()
        })
        this.meshes.clear()
        this.container.removeChildren()
    }

    update(delta: number, tick: number, now: number): void {
        // Terrain is static, no update needed
    }
}
