import * as PIXI from 'pixi.js'
import { Biome, TerrainGenerator } from '../TerrainGenerator'
import { COLORS } from '../utils/constants'

const TILE_SIZE = 64 // Size of each tile in pixels
const CHUNK_SIZE = 64 // Number of tiles per chunk

// RGB color interface
interface ColorRGB {
    r: number
    g: number
    b: number
}

// Biome-specific colors for the 15-biome volcanic system
const BIOME_COLORS: Record<Biome, ColorRGB> = {
    // Ocean biomes (depth-based blues)
    [Biome.Ocean]: { r: 11, g: 10, b: 42 },              // Darkest blue (deepest ocean)
    [Biome.TropicalOcean]: { r: 0, g: 91, b: 130 },      // Blue (tropical waters)
    [Biome.TemperateOcean]: { r: 7, g: 16, b: 59 },      // Dark blue (temperate)
    [Biome.ArcticOcean]: { r: 50, g: 70, b: 90 },        // Cold blue-gray
    
    // Special terrain
    [Biome.Beach]: { r: 225, g: 209, b: 132 },           // Sand
    [Biome.Mountain]: { r: 100, g: 100, b: 100 },        // Gray rock
    [Biome.Snow]: { r: 240, g: 248, b: 255 },            // White snow
    [Biome.Glacier]: { r: 200, g: 230, b: 255 },         // Ice blue
    
    // Hot biomes (yellows, oranges, greens)
    [Biome.HotDesert]: { r: 230, g: 200, b: 140 },       // Sandy yellow
    [Biome.HotSavanna]: { r: 210, g: 180, b: 100 },      // Dry grass
    [Biome.TropicalFrontier]: { r: 140, g: 170, b: 80 }, // Light tropical green
    [Biome.TropicalForest]: { r: 80, g: 140, b: 60 },    // Tropical green
    [Biome.TropicalRainforest]: { r: 40, g: 100, b: 40 },// Dark jungle green
    
    // Temperate biomes (greens, tans)
    [Biome.TemperateDesert]: { r: 200, g: 180, b: 130 }, // Tan desert
    [Biome.TemperateGrassland]: { r: 161, g: 164, b: 77 },// Grass green
    [Biome.TemperateFrontier]: { r: 153, g: 146, b: 78 },// Light forest
    [Biome.TemperateForest]: { r: 90, g: 130, b: 60 },   // Forest green
    [Biome.TemperateRainforest]: { r: 50, g: 110, b: 50 },// Dense green
    
    // Cold biomes (grays, dark greens)
    [Biome.ColdDesert]: { r: 150, g: 150, b: 140 },      // Gray-tan
    [Biome.Tundra]: { r: 140, g: 140, b: 120 },          // Gray-green
    [Biome.TaigaFrontier]: { r: 100, g: 120, b: 80 },    // Light taiga
    [Biome.Taiga]: { r: 70, g: 100, b: 60 },             // Dark taiga
    [Biome.TaigaRainforest]: { r: 50, g: 80, b: 50 },    // Dense taiga
}

// Get biome color with optional height-based shading
function getBiomeColor(biome: Biome, normalizedHeight: number): ColorRGB {
    const baseColor = BIOME_COLORS[biome]
    
    // Apply subtle height-based shading (±15%)
    const heightFactor = 0.85 + (normalizedHeight * 0.3)
    
    return {
        r: Math.max(0, Math.min(255, Math.floor(baseColor.r * heightFactor))),
        g: Math.max(0, Math.min(255, Math.floor(baseColor.g * heightFactor))),
        b: Math.max(0, Math.min(255, Math.floor(baseColor.b * heightFactor)))
    }
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

                // Get biome-specific color with height shading
                const normalizedHeight = tile.height / 255
                const colorRGB = getBiomeColor(tile.biome, normalizedHeight)
                
                // Convert RGB to hex color
                const color = (colorRGB.r << 16) | (colorRGB.g << 8) | colorRGB.b

                const x = tx * TILE_SIZE
                const y = ty * TILE_SIZE

                // Draw tile with biome color
                graphics.rect(x, y, TILE_SIZE, TILE_SIZE)
                graphics.fill({ color })

                // Add subtle water reflection for water tiles
                if (tile.isWater) {
                    graphics.rect(x, y, TILE_SIZE, TILE_SIZE)
                    graphics.fill({ color: 0x1e88e5, alpha: 0.2 })
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
