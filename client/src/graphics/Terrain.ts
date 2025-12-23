import * as PIXI from 'pixi.js'
import { Biome, TerrainGenerator } from '../TerrainGenerator'
import { COLORS } from '../utils/constants'

const TILE_SIZE = 64 // Size of each tile in pixels
const CHUNK_SIZE = 64 // Number of tiles per chunk

// Biome colors
const BIOME_COLORS: Record<Biome, number> = {
    [Biome.Ocean]: 0x1e3a5f,
    [Biome.Beach]: 0xf4e4c1,
    [Biome.Plains]: 0x7cb342,
    [Biome.Forest]: 0x2e7d32,
    [Biome.Desert]: 0xfdd835,
    [Biome.Snow]: 0xfafafa,
    [Biome.Mountain]: 0x616161,
    [Biome.Swamp]: 0x558b2f,
}

export class Terrain extends PIXI.Container {
    private terrainGen: TerrainGenerator
    private chunks: Map<string, PIXI.Graphics> = new Map()
    private loadedChunks: Set<string> = new Set()

    constructor(terrainGen: TerrainGenerator) {
        super()
        this.terrainGen = terrainGen
        this.sortableChildren = true
        this.zIndex = -1000 // Render behind everything
    }

    /**
     * Load chunks around a given world position
     */
    update(cameraX: number, cameraY: number, viewWidth: number, viewHeight: number) {
        // Convert camera position to chunk coordinates
        const worldSize = this.terrainGen.getWorldSize()
        const centerChunkX = Math.floor(cameraX / TILE_SIZE / CHUNK_SIZE)
        const centerChunkY = Math.floor(cameraY / TILE_SIZE / CHUNK_SIZE)

        // Load radius of 2 chunks around camera
        const loadRadius = 2
        const chunksToLoad = new Set<string>()

        for (let dy = -loadRadius; dy <= loadRadius; dy++) {
            for (let dx = -loadRadius; dx <= loadRadius; dx++) {
                const chunkX = centerChunkX + dx
                const chunkY = centerChunkY + dy
                const key = `${chunkX},${chunkY}`

                // Check if chunk is within world bounds
                if (
                    chunkX >= 0 &&
                    chunkX < Math.ceil(worldSize / CHUNK_SIZE) &&
                    chunkY >= 0 &&
                    chunkY < Math.ceil(worldSize / CHUNK_SIZE)
                ) {
                    chunksToLoad.add(key)

                    // Load chunk if not already loaded
                    if (!this.loadedChunks.has(key)) {
                        this.loadChunk(chunkX, chunkY)
                    }
                }
            }
        }

        // Unload chunks that are too far away
        for (const key of this.loadedChunks) {
            if (!chunksToLoad.has(key)) {
                this.unloadChunk(key)
            }
        }
    }

    private loadChunk(chunkX: number, chunkY: number) {
        const key = `${chunkX},${chunkY}`
        if (this.chunks.has(key)) return

        const graphics = new PIXI.Graphics()
        graphics.x = chunkX * CHUNK_SIZE * TILE_SIZE
        graphics.y = chunkY * CHUNK_SIZE * TILE_SIZE

        // Render all tiles in this chunk
        for (let ty = 0; ty < CHUNK_SIZE; ty++) {
            for (let tx = 0; tx < CHUNK_SIZE; tx++) {
                const worldX = chunkX * CHUNK_SIZE + tx
                const worldY = chunkY * CHUNK_SIZE + ty

                const tile = this.terrainGen.getTile(worldX, worldY)
                if (!tile) continue

                // Get base color for biome
                let color = BIOME_COLORS[tile.biome]
                
                // Add height-based shading for more visual depth
                const heightFactor = tile.height / 255
                const shadeFactor = 0.7 + (heightFactor * 0.3) // Range: 0.7 to 1.0
                const r = ((color >> 16) & 0xff) * shadeFactor
                const g = ((color >> 8) & 0xff) * shadeFactor
                const b = (color & 0xff) * shadeFactor
                const shadedColor = ((r << 16) | (g << 8) | b) & 0xffffff

                const x = tx * TILE_SIZE
                const y = ty * TILE_SIZE

                // Draw tile with height shading
                graphics.rect(x, y, TILE_SIZE, TILE_SIZE)
                graphics.fill({ color: shadedColor })

                // Add water overlay if water tile
                if (tile.isWater) {
                    graphics.rect(x, y, TILE_SIZE, TILE_SIZE)
                    graphics.fill({ color: 0x1e88e5, alpha: 0.6 })
                }

                // Optional: Remove grid lines for better performance
                // Uncomment if you want subtle borders between tiles
                // if (tile.biome !== Biome.Ocean) {
                //     graphics.rect(x, y, TILE_SIZE, TILE_SIZE)
                //     graphics.stroke({ width: 1, color: 0x000000, alpha: 0.05 })
                // }
            }
        }

        this.addChild(graphics)
        this.chunks.set(key, graphics)
        this.loadedChunks.add(key)
    }

    private unloadChunk(key: string) {
        const graphics = this.chunks.get(key)
        if (graphics) {
            this.removeChild(graphics)
            graphics.destroy()
            this.chunks.delete(key)
        }
        this.loadedChunks.delete(key)
    }

    /**
     * Clear all loaded terrain
     */
    clear() {
        for (const [key, graphics] of this.chunks) {
            this.removeChild(graphics)
            graphics.destroy()
        }
        this.chunks.clear()
        this.loadedChunks.clear()
    }
}
