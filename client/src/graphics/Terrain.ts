import * as PIXI from 'pixi.js'
import { Biome, TerrainGenerator } from '../TerrainGenerator'

const TILE_SIZE = 64 // Size of each tile in pixels
const CHUNK_SIZE = 64 // Number of tiles per chunk
const LOAD_RADIUS = 2 // Number of chunks to load around camera

// RGB color interface
interface ColorRGB {
    r: number
    g: number
    b: number
}

// Biome-specific colors for the 15-biome volcanic system (matching demo)
const BIOME_COLORS: Record<Biome, ColorRGB> = {
    // Ocean biomes
    [Biome.Ocean]: { r: 11, g: 10, b: 42 },
    [Biome.TropicalOcean]: { r: 103, g: 201, b: 200 },   // #67C9C8
    [Biome.TemperateOcean]: { r: 103, g: 162, b: 201 },  // #67A2C9
    [Biome.ArcticOcean]: { r: 56, g: 89, b: 181 },       // #3859B5
    
    // Special terrain
    [Biome.Beach]: { r: 225, g: 209, b: 132 },
    [Biome.Mountain]: { r: 100, g: 100, b: 100 },
    [Biome.Snow]: { r: 238, g: 238, b: 238 },            // #EEE
    [Biome.Glacier]: { r: 255, g: 255, b: 255 },         // white
    
    // Hot biomes
    [Biome.HotDesert]: { r: 232, g: 222, b: 153 },       // #E8DE99
    [Biome.HotSavanna]: { r: 210, g: 219, b: 164 },      // #D2DBA4
    [Biome.TropicalFrontier]: { r: 182, g: 219, b: 116 },// #B6DB74
    [Biome.TropicalForest]: { r: 140, g: 201, b: 79 },   // #8CC94F
    [Biome.TropicalRainforest]: { r: 132, g: 214, b: 49 },// #84D631
    
    // Temperate biomes
    [Biome.TemperateDesert]: { r: 234, g: 242, b: 179 }, // #EAF2B3
    [Biome.TemperateGrassland]: { r: 187, g: 212, b: 125 },// #BBD47D
    [Biome.TemperateFrontier]: { r: 165, g: 191, b: 99 },// #A5BF63
    [Biome.TemperateForest]: { r: 131, g: 161, b: 55 },  // #83A137
    [Biome.TemperateRainforest]: { r: 114, g: 138, b: 54 },// #728A36
    
    // Cold biomes
    [Biome.ColdDesert]: { r: 204, g: 230, b: 220 },      // #CCE6DC
    [Biome.Tundra]: { r: 179, g: 189, b: 162 },          // #B3BDA2
    [Biome.TaigaFrontier]: { r: 125, g: 138, b: 96 },    // #7D8A60
    [Biome.Taiga]: { r: 70, g: 107, b: 51 },             // #466B33
    [Biome.TaigaRainforest]: { r: 38, g: 87, b: 13 },    // #26570D
}

// Get biome color with optional height-based shading
function getBiomeColor(biome: Biome, normalizedHeight: number): number {
    const baseColor = BIOME_COLORS[biome]
    
    // Apply subtle height-based shading (±15%)
    const heightFactor = 0.85 + (normalizedHeight * 0.3)
    
    const r = Math.max(0, Math.min(255, Math.floor(baseColor.r * heightFactor)))
    const g = Math.max(0, Math.min(255, Math.floor(baseColor.g * heightFactor)))
    const b = Math.max(0, Math.min(255, Math.floor(baseColor.b * heightFactor)))
    
    return (r << 16) | (g << 8) | b
}

// Chunk cache with LRU eviction
class ChunkCache {
    private cache: Map<string, PIXI.Graphics> = new Map()
    private accessOrder: string[] = []
    private maxSize: number

    constructor(maxSize: number = 100) {
        this.maxSize = maxSize
    }

    get(key: string): PIXI.Graphics | undefined {
        const chunk = this.cache.get(key)
        if (chunk) {
            // Update access order for LRU
            const index = this.accessOrder.indexOf(key)
            if (index > -1) {
                this.accessOrder.splice(index, 1)
            }
            this.accessOrder.push(key)
        }
        return chunk
    }

    set(key: string, chunk: PIXI.Graphics): void {
        // Evict oldest if at capacity
        if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
            const oldest = this.accessOrder.shift()
            if (oldest) {
                const oldChunk = this.cache.get(oldest)
                if (oldChunk) {
                    oldChunk.destroy()
                    this.cache.delete(oldest)
                }
            }
        }

        this.cache.set(key, chunk)
        this.accessOrder.push(key)
    }

    has(key: string): boolean {
        return this.cache.has(key)
    }

    delete(key: string): void {
        const chunk = this.cache.get(key)
        if (chunk) {
            chunk.destroy()
            this.cache.delete(key)
            const index = this.accessOrder.indexOf(key)
            if (index > -1) {
                this.accessOrder.splice(index, 1)
            }
        }
    }

    clear(): void {
        for (const chunk of this.cache.values()) {
            chunk.destroy()
        }
        this.cache.clear()
        this.accessOrder = []
    }
}

export class Terrain extends PIXI.Container {
    private terrainGen: TerrainGenerator
    private chunkCache: ChunkCache
    private loadedChunks: Set<string> = new Set()
    private worldSizeChunks: number

    constructor(terrainGen: TerrainGenerator) {
        super()
        this.terrainGen = terrainGen
        this.sortableChildren = true
        this.zIndex = -1000 // Render behind everything
        
        const worldSize = terrainGen.getWorldSize()
        this.worldSizeChunks = Math.ceil(worldSize / CHUNK_SIZE)
        
        // Cache size based on typical view area + buffer
        // At 2 load radius: (2*2+1)^2 = 25 chunks visible, cache 100 for buffer
        this.chunkCache = new ChunkCache(100)
    }

    /**
     * Load chunks around a given world position
     */
    update(cameraX: number, cameraY: number, viewWidth: number, viewHeight: number) {
        // Convert camera position to chunk coordinates
        const centerChunkX = Math.floor(cameraX / TILE_SIZE / CHUNK_SIZE)
        const centerChunkY = Math.floor(cameraY / TILE_SIZE / CHUNK_SIZE)

        // Determine which chunks should be loaded
        const chunksToLoad = new Set<string>()

        for (let dy = -LOAD_RADIUS; dy <= LOAD_RADIUS; dy++) {
            for (let dx = -LOAD_RADIUS; dx <= LOAD_RADIUS; dx++) {
                const chunkX = centerChunkX + dx
                const chunkY = centerChunkY + dy
                const key = `${chunkX},${chunkY}`

                // Check if chunk is within world bounds
                if (chunkX >= 0 && chunkX < this.worldSizeChunks &&
                    chunkY >= 0 && chunkY < this.worldSizeChunks) {
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
        
        // Check cache first
        let graphics = this.chunkCache.get(key)
        
        if (!graphics) {
            // Create new chunk graphics
            graphics = this.renderChunk(chunkX, chunkY)
            this.chunkCache.set(key, graphics)
        }

        // Add to stage if not already present
        if (!this.children.includes(graphics)) {
            this.addChild(graphics)
        }
        
        this.loadedChunks.add(key)
    }

    private renderChunk(chunkX: number, chunkY: number): PIXI.Graphics {
        const graphics = new PIXI.Graphics()
        graphics.x = chunkX * CHUNK_SIZE * TILE_SIZE
        graphics.y = chunkY * CHUNK_SIZE * TILE_SIZE

        // Batch rendering: collect all tiles by color first
        const tilesByColor = new Map<number, Array<{x: number, y: number}>>()

        // Collect tiles
        for (let ty = 0; ty < CHUNK_SIZE; ty++) {
            for (let tx = 0; tx < CHUNK_SIZE; tx++) {
                const worldX = chunkX * CHUNK_SIZE + tx
                const worldY = chunkY * CHUNK_SIZE + ty

                const tile = this.terrainGen.getTile(worldX, worldY)
                if (!tile) continue

                const normalizedHeight = tile.height / 255
                const color = getBiomeColor(tile.biome, normalizedHeight)

                if (!tilesByColor.has(color)) {
                    tilesByColor.set(color, [])
                }
                tilesByColor.get(color)!.push({
                    x: tx * TILE_SIZE,
                    y: ty * TILE_SIZE
                })
            }
        }

        // Batch render tiles by color
        for (const [color, tiles] of tilesByColor) {
            for (const tile of tiles) {
                graphics.rect(tile.x, tile.y, TILE_SIZE, TILE_SIZE).fill(color)
            }
        }

        // Add water reflection overlay
        for (let ty = 0; ty < CHUNK_SIZE; ty++) {
            for (let tx = 0; tx < CHUNK_SIZE; tx++) {
                const worldX = chunkX * CHUNK_SIZE + tx
                const worldY = chunkY * CHUNK_SIZE + ty

                const tile = this.terrainGen.getTile(worldX, worldY)
                if (tile && tile.isWater) {
                    const x = tx * TILE_SIZE
                    const y = ty * TILE_SIZE
                    graphics.rect(x, y, TILE_SIZE, TILE_SIZE).fill({color: 0x1e88e5, alpha: 0.2})
                }
            }
        }

        return graphics
    }

    private unloadChunk(key: string) {
        const graphics = this.chunkCache.get(key)
        if (graphics && this.children.includes(graphics)) {
            this.removeChild(graphics)
        }
        this.loadedChunks.delete(key)
        // Keep in cache for potential re-use
    }

    /**
     * Clear all loaded terrain
     */
    clear() {
        this.chunkCache.clear()
        this.loadedChunks.clear()
        this.removeChildren()
    }

    /**
     * Pre-load chunks for smooth experience
     */
    preloadArea(centerX: number, centerY: number, radius: number) {
        const centerChunkX = Math.floor(centerX / TILE_SIZE / CHUNK_SIZE)
        const centerChunkY = Math.floor(centerY / TILE_SIZE / CHUNK_SIZE)

        for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
                const chunkX = centerChunkX + dx
                const chunkY = centerChunkY + dy

                if (chunkX >= 0 && chunkX < this.worldSizeChunks &&
                    chunkY >= 0 && chunkY < this.worldSizeChunks) {
                    
                    const key = `${chunkX},${chunkY}`
                    if (!this.chunkCache.has(key)) {
                        const graphics = this.renderChunk(chunkX, chunkY)
                        this.chunkCache.set(key, graphics)
                    }
                }
            }
        }
    }
}