import * as PIXI from 'pixi.js'
import { BiomeType } from '../enums/BiomeType'
import { Renderer } from '../Renderer'

interface TerrainMesh {
    id: number
    biome: BiomeType
    vertices: { x: number; y: number }[]
    indices: number[]
}

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
        if (this.meshes.has(id)) {
            return
        }

        const graphics = new PIXI.Graphics()
        const color = this.getBiomeColor(biome)

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
        }

        // log out the x/y of the first vertex and the number of vertices
        console.log(
            `First vertex: (${vertices[0].x}, ${vertices[0].y}), Total vertices: ${vertices.length}`
        )

        this.container.addChild(graphics)
        this.meshes.set(id, graphics)

        const biomeName = this.getBiomeName(biome)
        console.log(
            `Added terrain mesh ${id} (${biomeName}) with ${vertices.length} vertices and ${indices.length / 3} triangles`
        )
    }

    private getBiomeName(biome: BiomeType): string {
        const names = [
            'DEEP_WATER',
            'SHALLOW_WATER',
            'BEACH',
            'GRASSLAND',
            'FOREST',
            'MOUNTAIN',
            'PEAK',
        ]
        return names[biome] || 'UNKNOWN'
    }

    private getBiomeColor(biome: BiomeType): number {
        // Colors matching server-side terrain generation
        switch (biome) {
            case BiomeType.BIOME_DEEP_WATER:
                return 0x08183a // Dark blue
            case BiomeType.BIOME_SHALLOW_WATER:
                return 0x285596 // Light blue
            case BiomeType.BIOME_BEACH:
                return 0xd2be8c // Sandy beach
            case BiomeType.BIOME_GRASSLAND:
                return 0x509446 // Green grass
            case BiomeType.BIOME_FOREST:
                return 0x2d5a2d // Dark green
            case BiomeType.BIOME_MOUNTAIN:
                return 0x8b7355 // Brown mountain
            case BiomeType.BIOME_PEAK:
                return 0xe8e8e8 // Light gray peak
            default:
                return 0xff00ff // Magenta for unknown
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
