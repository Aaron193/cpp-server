import * as PIXI from 'pixi.js'
import { Biome, TerrainGenerator } from '../TerrainGenerator'
import { COLORS } from '../utils/constants'

const TILE_SIZE = 64 // Size of each tile in pixels
const CHUNK_SIZE = 64 // Number of tiles per chunk

// Height-based color map inspired by volcanic island generation
// Maps normalized height (0-1) to RGB colors - MUST MATCH MINIMAP COLORS
interface ColorRGB {
    r: number
    g: number
    b: number
}

const HEIGHT_COLOR_MAP: Record<number, ColorRGB> = {
    1.0: { r: 61, g: 70, b: 41 },      // Dark green (high mountains/forest)
    0.8: { r: 118, g: 133, b: 78 },    // Green (hills)
    0.69: { r: 153, g: 146, b: 78 },   // Tan (plains)
    0.68: { r: 161, g: 164, b: 77 },   // Light tan (plains)
    0.545: { r: 197, g: 192, b: 111 }, // Pale tan (highlands)
    0.53: { r: 225, g: 209, b: 132 },  // Sand (upper beach)
    0.51: { r: 248, g: 238, b: 202 },  // Light sand (beach)
    0.5: { r: 219, g: 187, b: 130 },   // Brown sand (beach edge)
    0.49: { r: 10, g: 194, b: 182 },   // Cyan (shallow water)
    0.48: { r: 8, g: 139, b: 151 },    // Blue-cyan (water)
    0.46: { r: 0, g: 91, b: 130 },     // Blue (deeper water)
    0.35: { r: 0, g: 39, b: 100 },     // Dark blue (deep ocean)
    0.25: { r: 7, g: 16, b: 59 },      // Very dark blue (deeper ocean)
    0.15: { r: 7, g: 16, b: 59 },      // Very dark blue
    0.0: { r: 11, g: 10, b: 42 },      // Darkest blue (deepest ocean)
}

// Get color for a given normalized height value (0-1)
function getHeightColor(normalizedHeight: number): ColorRGB {
    const keys = Object.keys(HEIGHT_COLOR_MAP).map(Number).sort((a, b) => b - a)
    
    // Find closest key
    let closestKey = keys[0]
    let minDiff = Math.abs(normalizedHeight - closestKey)
    
    for (const key of keys) {
        const diff = Math.abs(normalizedHeight - key)
        if (diff < minDiff) {
            minDiff = diff
            closestKey = key
        }
    }
    
    return HEIGHT_COLOR_MAP[closestKey]
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

                // Normalize height and get color from height-based map
                const normalizedHeight = tile.height / 255
                const colorRGB = getHeightColor(normalizedHeight)
                
                // Convert RGB to hex color
                const color = (colorRGB.r << 16) | (colorRGB.g << 8) | colorRGB.b

                const x = tx * TILE_SIZE
                const y = ty * TILE_SIZE

                // Draw tile with height-based color
                graphics.rect(x, y, TILE_SIZE, TILE_SIZE)
                graphics.fill({ color })

                // Add subtle water reflection for water tiles
                if (tile.isWater) {
                    graphics.rect(x, y, TILE_SIZE, TILE_SIZE)
                    graphics.fill({ color: 0x1e88e5, alpha: 0.3 })
                }
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
