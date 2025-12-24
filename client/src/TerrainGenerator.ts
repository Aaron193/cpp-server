import { PerlinNoise } from './utils/PerlinNoise'

export enum Biome {
    // Ocean biomes
    Ocean = 0,
    TropicalOcean,
    TemperateOcean,
    ArcticOcean,
    
    // Special terrain
    Beach,
    Mountain,
    Snow,
    Glacier,
    
    // Hot biomes (temp > 0.25)
    HotDesert,
    HotSavanna,
    TropicalFrontier,
    TropicalForest,
    TropicalRainforest,
    
    // Temperate biomes (-0.25 <= temp <= 0.25)
    TemperateDesert,
    TemperateGrassland,
    TemperateFrontier,
    TemperateForest,
    TemperateRainforest,
    
    // Cold biomes (temp < -0.25)
    ColdDesert,
    Tundra,
    TaigaFrontier,
    Taiga,
    TaigaRainforest,
}

export interface Tile {
    height: number // 0-255
    biome: Biome
    isWater: boolean
    flowDirection: number // 0-255 representing 0-360 degrees
}

export interface River {
    path: Array<{ x: number; y: number }>
}

const SEA_LEVEL = 90
const BEACH_LEVEL = 100
const MOUNTAIN_LEVEL = 210
const RIVER_WIDTH = 3

export class TerrainGenerator {
    private seed: number
    private worldSize: number
    private heightNoise: PerlinNoise
    private moistureNoise: PerlinNoise
    private temperatureNoise: PerlinNoise
    private tiles: Tile[] = []
    private rivers: River[] = []
    private height: number[] = []
    private biome: Biome[] = []
    private flags: number[] = []  // TileFlags: Water = 1, Cover = 2
    private flowDirection: number[] = []
    
    // Float working buffers for volcanic generation
    private heightFloat: number[] = []
    private precipitationFloat: number[] = []
    private temperatureFloat: number[] = []

    constructor(seed: number, worldSize: number) {
        this.seed = seed
        this.worldSize = worldSize

        // Initialize noise generators with derived seeds (match server)
        this.heightNoise = new PerlinNoise(seed)
        this.moistureNoise = new PerlinNoise(seed + 1000)
        this.temperatureNoise = new PerlinNoise(seed + 2000)

        const totalTiles = worldSize * worldSize
        this.tiles = new Array(totalTiles)
        this.height = new Array(totalTiles)
        this.biome = new Array(totalTiles)
        this.flags = new Array(totalTiles).fill(0)
        this.flowDirection = new Array(totalTiles).fill(0)
        
        // Allocate float buffers
        this.heightFloat = new Array(totalTiles)
        this.precipitationFloat = new Array(totalTiles)
        this.temperatureFloat = new Array(totalTiles)
    }

    generate(rivers?: Array<{path: Array<{x: number, y: number}>}>) {
        console.log('Generating terrain with volcanic island method...')
        
        this.generateHeightmap()
        this.generatePrecipitation()
        this.generateTemperature()
        this.generateBiomes()
        
        if (rivers) {
            // Use server-provided river data
            console.log('Using server river data:', rivers.length, 'rivers')
            this.rivers = rivers
            for (const river of rivers) {
                this.applyRiverToMap(river.path)
            }
        }
        
        this.buildTiles()
        
        // Free float buffers
        this.heightFloat = []
        this.precipitationFloat = []
        this.temperatureFloat = []
    }

    private generateHeightmap() {
        // Volcanic Island Generation Method (matches C++)
        // Step 1: Create radial gradient
        const centerX = this.worldSize * 0.5
        const centerY = this.worldSize * 0.5
        const radius = this.worldSize * 0.44
        const radialGradient = this.generateRadialGradient(centerX, centerY, radius, 1.0, -1.0)
        
        // Step 2: Create fractal noise
        const fractalNoise = this.generateFractalNoise(this.seed, 8)
        
        // Step 3: Weighted mean (57% gradient, 43% noise)
        this.heightFloat = this.weightedMean(radialGradient, fractalNoise, 1.33)
        
        // Convert float [-1,1] to uint8 [0,255]
        for (let i = 0; i < this.heightFloat.length; i++) {
            const normalized = Math.max(0, Math.min(1, (this.heightFloat[i] + 1.0) * 0.5))
            this.height[i] = Math.floor(normalized * 255)
        }
    }
    
    private generatePrecipitation() {
        // Rain Shadow Effect (matches C++)
        const centerX = this.worldSize * 0.5
        const centerY = this.worldSize * 0.5
        const radius = this.worldSize * 0.33
        
        // Random wind direction (using seed + 3000)
        const rng = this.seededRandom(this.seed + 3000)
        const windX = (rng() - 0.5) * this.worldSize * 0.16
        const windY = (rng() - 0.5) * this.worldSize * 0.16
        
        const gradient1 = this.generateRadialGradient(centerX, centerY, radius, 1.0, 0.0)
        const gradient2 = this.generateRadialGradient(centerX + windX, centerY + windY, radius, 1.0, 0.0)
        
        // Subtract gradients
        const rainShadow = this.subtract(gradient1, gradient2)
        
        // Add fractal noise
        const fractalNoise = this.generateFractalNoise(this.seed + 1000, 8)
        
        // Weighted mean (71% noise, 29% rain shadow)
        this.precipitationFloat = this.weightedMean(rainShadow, fractalNoise, 2.5)
    }
    
    private generateTemperature() {
        // North-South gradient + elevation cooling (matches C++)
        const linearGradient = this.generateLinearGradient(-1.0, 1.0)
        const fractalNoise = this.generateFractalNoise(this.seed + 2000, 8)
        
        // Weighted mean (60% gradient, 40% noise)
        this.temperatureFloat = this.weightedMean(linearGradient, fractalNoise, 1.5)
        
        // Adjust for elevation
        const elevationCooling = 1.0
        const elevationOffset = 0.16
        for (let i = 0; i < this.temperatureFloat.length; i++) {
            if (this.heightFloat[i] > 0.0) {
                this.temperatureFloat[i] -= (this.heightFloat[i] - elevationOffset) * elevationCooling
                this.temperatureFloat[i] = Math.max(-1, Math.min(1, this.temperatureFloat[i]))
            }
        }
    }

    private generateBiomes() {
        // 15-Biome System: Temperature (3) x Moisture (5) - matches C++
        for (let y = 0; y < this.worldSize; y++) {
            for (let x = 0; x < this.worldSize; x++) {
                const idx = this.worldToTileIndex(x, y)
                
                const elevation = this.heightFloat[idx]
                const temperature = this.temperatureFloat[idx]
                const precipitation = this.precipitationFloat[idx]
                
                let biome: Biome
                
                // Ocean biomes
                if (elevation < 0.0) {
                    if (temperature > 0.25) {
                        biome = Biome.TropicalOcean
                    } else if (temperature < -0.25) {
                        biome = Biome.ArcticOcean
                    } else {
                        biome = Biome.TemperateOcean
                    }
                    this.flags[idx] |= 1 // Mark as water
                }
                // Beach
                else if (elevation < 0.18) {
                    biome = Biome.Beach
                }
                // Mountain (very high elevation)
                else if (elevation > 0.75) {
                    biome = Biome.Mountain
                }
                // Glacier
                else if (temperature < -0.66) {
                    biome = Biome.Glacier
                }
                // Snow
                else if (temperature < -0.55) {
                    biome = Biome.Snow
                }
                // Cold biomes
                else if (temperature < -0.25) {
                    if (precipitation < -0.25) {
                        biome = Biome.ColdDesert
                    } else if (precipitation < 0.0) {
                        biome = Biome.Tundra
                    } else if (precipitation < 0.25) {
                        biome = Biome.TaigaFrontier
                    } else if (precipitation < 0.5) {
                        biome = Biome.Taiga
                    } else {
                        biome = Biome.TaigaRainforest
                    }
                }
                // Hot biomes
                else if (temperature > 0.25) {
                    if (precipitation < -0.25) {
                        biome = Biome.HotDesert
                    } else if (precipitation < 0.0) {
                        biome = Biome.HotSavanna
                    } else if (precipitation < 0.25) {
                        biome = Biome.TropicalFrontier
                    } else if (precipitation < 0.5) {
                        biome = Biome.TropicalForest
                    } else {
                        biome = Biome.TropicalRainforest
                    }
                }
                // Temperate biomes
                else {
                    if (precipitation < -0.25) {
                        biome = Biome.TemperateDesert
                    } else if (precipitation < 0.0) {
                        biome = Biome.TemperateGrassland
                    } else if (precipitation < 0.25) {
                        biome = Biome.TemperateFrontier
                    } else if (precipitation < 0.5) {
                        biome = Biome.TemperateForest
                    } else {
                        biome = Biome.TemperateRainforest
                    }
                }
                
                this.biome[idx] = biome
            }
        }
    }

    private generateRadialGradient(centerX: number, centerY: number, radius: number, centerValue: number, edgeValue: number): number[] {
        const output = new Array(this.worldSize * this.worldSize)
        const radiusSquared = radius * radius
        const invRadiusSquared = 1.0 / radiusSquared
        
        for (let y = 0; y < this.worldSize; y++) {
            for (let x = 0; x < this.worldSize; x++) {
                const idx = this.worldToTileIndex(x, y)
                
                const dx = x - centerX
                const dy = y - centerY
                const distSquared = dx * dx + dy * dy
                
                const t = Math.max(0, Math.min(1, distSquared * invRadiusSquared))
                output[idx] = centerValue + (edgeValue - centerValue) * t
            }
        }
        
        return output
    }

    private generateLinearGradient(startValue: number, endValue: number): number[] {
        const output = new Array(this.worldSize * this.worldSize)
        const scale = 1.0 / (this.worldSize - 1)
        
        for (let y = 0; y < this.worldSize; y++) {
            const t = y * scale
            const value = startValue + (endValue - startValue) * t
            
            for (let x = 0; x < this.worldSize; x++) {
                const idx = this.worldToTileIndex(x, y)
                output[idx] = value
            }
        }
        
        return output
    }

    private generateFractalNoise(seed: number, octaves: number): number[] {
        const output = new Array(this.worldSize * this.worldSize)
        const noise = new PerlinNoise(seed)
        
        const frequencies = [1/128, 1/64, 1/32, 1/16, 1/8, 1/4, 1/2, 1]
        const weights = [1/128, 1/128, 1/64, 1/32, 1/16, 1/8, 1/4, 1/2]
        
        for (let y = 0; y < this.worldSize; y++) {
            for (let x = 0; x < this.worldSize; x++) {
                const idx = this.worldToTileIndex(x, y)
                
                let total = 0
                for (let i = 0; i < octaves && i < 8; i++) {
                    total += noise.noise(x * frequencies[i], y * frequencies[i]) * weights[i]
                }
                
                output[idx] = total
            }
        }
        
        return output
    }

    private weightedMean(mapA: number[], mapB: number[], weight: number): number[] {
        const output = new Array(mapA.length)
        const invWeight = 1.0 / weight
        
        for (let i = 0; i < mapA.length; i++) {
            output[i] = ((mapA[i] * weight) + (mapB[i] * invWeight)) * 0.5
        }
        
        return output
    }

    private subtract(mapA: number[], mapB: number[]): number[] {
        const output = new Array(mapA.length)
        
        for (let i = 0; i < mapA.length; i++) {
            output[i] = mapA[i] - mapB[i]
        }
        
        return output
    }
    
    private seededRandom(seed: number): () => number {
        let state = seed
        return () => {
            state = (state * 9301 + 49297) % 233280
            return state / 233280
        }
    }

    private applyRiverToMap(path: Array<{ x: number; y: number }>) {
        if (path.length === 0) return
        
        // Mark river tiles and calculate flow direction
        for (let i = 0; i < path.length; i++) {
            const x = path[i].x
            const y = path[i].y

            // Calculate flow direction from this tile to next
            let nextX = x
            let nextY = y
            if (i + 1 < path.length) {
                nextX = path[i + 1].x
                nextY = path[i + 1].y
            }

            // Calculate angle in radians
            const dx = nextX - x
            const dy = nextY - y
            const angle = Math.atan2(dy, dx)
            
            // Convert to 0-255 range (0-360 degrees)
            const flowDir = Math.floor(((angle + Math.PI) / (2 * Math.PI)) * 255)

            // Mark the center tile as water and set flow direction
            if (this.inBounds(x, y)) {
                const idx = this.worldToTileIndex(x, y)
                this.flags[idx] |= 1 // Water flag
                this.flowDirection[idx] = flowDir
            }

            // Expand river width
            for (let dy = -RIVER_WIDTH; dy <= RIVER_WIDTH; dy++) {
                for (let dx = -RIVER_WIDTH; dx <= RIVER_WIDTH; dx++) {
                    const nx = x + dx
                    const ny = y + dy

                    if (!this.inBounds(nx, ny)) continue

                    const nIdx = this.worldToTileIndex(nx, ny)
                    const dist = Math.sqrt(dx * dx + dy * dy)

                    if (dist <= RIVER_WIDTH) {
                        this.flags[nIdx] |= 1 // Water flag
                        if (this.flowDirection[nIdx] === 0) {
                            this.flowDirection[nIdx] = flowDir
                        }

                        // Mark edge tiles
                        if (dist > RIVER_WIDTH - 0.5) {
                            this.flags[nIdx] |= 2 // Cover flag
                        }
                    }
                }
            }
        }

        // Post-process to add edge biomes
        for (let y = 0; y < this.worldSize; y++) {
            for (let x = 0; x < this.worldSize; x++) {
                const idx = this.worldToTileIndex(x, y)

                if (this.flags[idx] & 1) {
                    // This is water
                    let isEdge = false
                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dx = -1; dx <= 1; dx++) {
                            if (dx === 0 && dy === 0) continue
                            const nIdx = this.worldToTileIndex(x + dx, y + dy)
                            if (this.inBounds(x + dx, y + dy)) {
                                if (!(this.flags[nIdx] & 1)) {
                                    isEdge = true
                                    break
                                }
                            }
                        }
                        if (isEdge) break
                    }

                    // Edge tiles get special biome treatment
                    if (isEdge && !(this.flags[idx] & 2)) {
                        const height = this.height[idx]
                        // Water edges become beach or wetland depending on height
                        if (height < SEA_LEVEL + 15) {
                            this.biome[idx] = Biome.Beach
                        } else {
                            // Use wetland biome (rainforest) for river edges
                            this.biome[idx] = Biome.TemperateRainforest
                        }
                    }
                }
            }
        }
    }

    private buildTiles() {
        for (let y = 0; y < this.worldSize; y++) {
            for (let x = 0; x < this.worldSize; x++) {
                const idx = this.worldToTileIndex(x, y)
                this.tiles[idx] = {
                    height: this.height[idx],
                    biome: this.biome[idx],
                    isWater: (this.flags[idx] & 1) !== 0,
                    flowDirection: this.flowDirection[idx],
                }
            }
        }
    }

    private inBounds(x: number, y: number): boolean {
        return x >= 0 && x < this.worldSize && y >= 0 && y < this.worldSize
    }

    private worldToTileIndex(x: number, y: number): number {
        return y * this.worldSize + x
    }

    getTile(x: number, y: number): Tile | null {
        if (x < 0 || x >= this.worldSize || y < 0 || y >= this.worldSize) {
            return null
        }
        return this.tiles[y * this.worldSize + x]
    }

    getWorldSize(): number {
        return this.worldSize
    }

    getRivers(): River[] {
        return this.rivers
    }
}
