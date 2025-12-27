import { PerlinNoise } from './utils/PerlinNoise'

// match WorldGeneratorConstants.hpp
const ISLAND_CENTER_X_RATIO = 0.5
const ISLAND_CENTER_Y_RATIO = 0.5
const ISLAND_RADIUS_RATIO = 0.44
const HEIGHT_GRADIENT_WEIGHT = 1.33

const RAIN_SHADOW_RADIUS_RATIO = 0.33
const WIND_OFFSET_RANGE = 0.08
const PRECIPITATION_NOISE_WEIGHT = 2.5

const TEMPERATURE_GRADIENT_WEIGHT = 1.5
const ELEVATION_COOLING_FACTOR = 1.0
const ELEVATION_COOLING_OFFSET = 0.16

const SEA_LEVEL_NORMALIZED = 0.0
const BEACH_LEVEL_NORMALIZED = 0.18
const MOUNTAIN_LEVEL_NORMALIZED = 0.75
const TEMP_COLD_THRESHOLD = -0.25
const TEMP_HOT_THRESHOLD = 0.25
const TEMP_GLACIER_THRESHOLD = -0.66
const TEMP_SNOW_THRESHOLD = -0.55
const PRECIP_LOW = -0.25
const PRECIP_MED_LOW = 0.0
const PRECIP_MED = 0.25
const PRECIP_HIGH = 0.5

const FRACTAL_OCTAVES = 8
const FRACTAL_FREQUENCIES = [1/128, 1/64, 1/32, 1/16, 1/8, 1/4, 1/2, 1]
const FRACTAL_WEIGHTS = [1/128, 1/128, 1/64, 1/32, 1/16, 1/8, 1/4, 1/2]

const SEA_LEVEL = 90
const BEACH_LEVEL = 100
const MOUNTAIN_LEVEL = 210
const RIVER_WIDTH = 3

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

export const BIOME_NAMES: Record<Biome, string> = {
    [Biome.Ocean]: 'Ocean',
    [Biome.TropicalOcean]: 'Tropical Ocean',
    [Biome.TemperateOcean]: 'Temperate Ocean',
    [Biome.ArcticOcean]: 'Arctic Ocean',
    [Biome.Beach]: 'Beach',
    [Biome.Mountain]: 'Mountain',
    [Biome.Snow]: 'Snow',
    [Biome.Glacier]: 'Glacier',
    [Biome.HotDesert]: 'Hot Desert',
    [Biome.HotSavanna]: 'Hot Savanna',
    [Biome.TropicalFrontier]: 'Tropical Frontier',
    [Biome.TropicalForest]: 'Tropical Forest',
    [Biome.TropicalRainforest]: 'Tropical Rainforest',
    [Biome.TemperateDesert]: 'Temperate Desert',
    [Biome.TemperateGrassland]: 'Temperate Grassland',
    [Biome.TemperateFrontier]: 'Temperate Frontier',
    [Biome.TemperateForest]: 'Temperate Forest',
    [Biome.TemperateRainforest]: 'Temperate Rainforest',
    [Biome.ColdDesert]: 'Cold Desert',
    [Biome.Tundra]: 'Tundra',
    [Biome.TaigaFrontier]: 'Taiga Frontier',
    [Biome.Taiga]: 'Taiga',
    [Biome.TaigaRainforest]: 'Taiga Rainforest',
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

export class TerrainGenerator {
    private seed: number
    private worldSize: number
    private heightNoise: PerlinNoise
    private moistureNoise: PerlinNoise
    private temperatureNoise: PerlinNoise
    private rivers: River[] = []
    
    private height: Uint8Array
    private biome: Uint8Array
    private flags: Uint8Array
    private flowDirection: Uint8Array
    
    private heightFloat: Float32Array
    private precipitationFloat: Float32Array
    private temperatureFloat: Float32Array

    constructor(seed: number, worldSize: number) {
        this.seed = seed
        this.worldSize = worldSize

        // Initialize noise generators with derived seeds (match server)
        this.heightNoise = new PerlinNoise(seed)
        this.moistureNoise = new PerlinNoise(seed + 1000)
        this.temperatureNoise = new PerlinNoise(seed + 2000)

        const totalTiles = worldSize * worldSize
        
        this.height = new Uint8Array(totalTiles)
        this.biome = new Uint8Array(totalTiles)
        this.flags = new Uint8Array(totalTiles)
        this.flowDirection = new Uint8Array(totalTiles)
        
        this.heightFloat = new Float32Array(totalTiles)
        this.precipitationFloat = new Float32Array(totalTiles)
        this.temperatureFloat = new Float32Array(totalTiles)
    }

    generate(rivers?: Array<{path: Array<{x: number, y: number}>}>) {
        console.log('Generating terrain with volcanic island method...')
        
        this.generateHeightmap()
        this.generatePrecipitation()
        this.generateTemperature()
        this.generateBiomes()
        
        if (rivers) {
            console.log('Using server river data:', rivers.length, 'rivers')
            this.rivers = rivers
            for (const river of rivers) {
                this.applyRiverToMap(river.path)
            }
        }
        
    }

    private generateHeightmap() {
        const centerX = this.worldSize * ISLAND_CENTER_X_RATIO
        const centerY = this.worldSize * ISLAND_CENTER_Y_RATIO
        const radius = this.worldSize * ISLAND_RADIUS_RATIO
        const radialGradient = this.generateRadialGradient(centerX, centerY, radius, 1.0, -1.0)
        
        const fractalNoise = this.generateFractalNoise(this.seed, FRACTAL_OCTAVES)
        
        this.weightedMean(this.heightFloat, radialGradient, fractalNoise, HEIGHT_GRADIENT_WEIGHT)
        
        for (let i = 0; i < this.heightFloat.length; i++) {
            const normalized = Math.max(0, Math.min(1, (this.heightFloat[i] + 1.0) * 0.5))
            this.height[i] = Math.floor(normalized * 255)
        }
    }
    
    private generatePrecipitation() {
        const centerX = this.worldSize * ISLAND_CENTER_X_RATIO
        const centerY = this.worldSize * ISLAND_CENTER_Y_RATIO
        const radius = this.worldSize * RAIN_SHADOW_RADIUS_RATIO
        
        const mt = new MersenneTwisterRNG(this.seed + 3000)
        const windX = (mt.random() - 0.5) * this.worldSize * WIND_OFFSET_RANGE * 2
        const windY = (mt.random() - 0.5) * this.worldSize * WIND_OFFSET_RANGE * 2
        
        const gradient1 = this.generateRadialGradient(centerX, centerY, radius, 1.0, 0.0)
        const gradient2 = this.generateRadialGradient(centerX + windX, centerY + windY, radius, 1.0, 0.0)
        
        const rainShadow = this.subtract(gradient1, gradient2)
        const fractalNoise = this.generateFractalNoise(this.seed + 1000, FRACTAL_OCTAVES)
        
        this.weightedMean(this.precipitationFloat, rainShadow, fractalNoise, PRECIPITATION_NOISE_WEIGHT)
    }
    
    private generateTemperature() {
        const linearGradient = this.generateLinearGradient(-1.0, 1.0)
        const fractalNoise = this.generateFractalNoise(this.seed + 2000, FRACTAL_OCTAVES)
        
        this.weightedMean(this.temperatureFloat, linearGradient, fractalNoise, TEMPERATURE_GRADIENT_WEIGHT)
        
        for (let i = 0; i < this.temperatureFloat.length; i++) {
            if (this.heightFloat[i] > 0.0) {
                this.temperatureFloat[i] -= (this.heightFloat[i] - ELEVATION_COOLING_OFFSET) * ELEVATION_COOLING_FACTOR
                this.temperatureFloat[i] = Math.max(-1, Math.min(1, this.temperatureFloat[i]))
            }
        }
    }

    private generateBiomes() {
        for (let y = 0; y < this.worldSize; y++) {
            for (let x = 0; x < this.worldSize; x++) {
                const idx = this.worldToTileIndex(x, y)
                
                const elevation = this.heightFloat[idx]
                const temperature = this.temperatureFloat[idx]
                const precipitation = this.precipitationFloat[idx]
                
                let biome: Biome
                
                // Ocean biomes
                if (elevation < SEA_LEVEL_NORMALIZED) {
                    if (temperature > TEMP_HOT_THRESHOLD) {
                        biome = Biome.TropicalOcean
                    } else if (temperature < TEMP_COLD_THRESHOLD) {
                        biome = Biome.ArcticOcean
                    } else {
                        biome = Biome.TemperateOcean
                    }
                    this.flags[idx] |= 1 // Mark as water
                }
                else if (elevation < BEACH_LEVEL_NORMALIZED) {
                    biome = Biome.Beach
                }
                else if (elevation > MOUNTAIN_LEVEL_NORMALIZED) {
                    biome = Biome.Mountain
                }
                else if (temperature < TEMP_GLACIER_THRESHOLD) {
                    biome = Biome.Glacier
                }
                else if (temperature < TEMP_SNOW_THRESHOLD) {
                    biome = Biome.Snow
                }
                else if (temperature < TEMP_COLD_THRESHOLD) {
                    if (precipitation < PRECIP_LOW) {
                        biome = Biome.ColdDesert
                    } else if (precipitation < PRECIP_MED_LOW) {
                        biome = Biome.Tundra
                    } else if (precipitation < PRECIP_MED) {
                        biome = Biome.TaigaFrontier
                    } else if (precipitation < PRECIP_HIGH) {
                        biome = Biome.Taiga
                    } else {
                        biome = Biome.TaigaRainforest
                    }
                }
                else if (temperature > TEMP_HOT_THRESHOLD) {
                    if (precipitation < PRECIP_LOW) {
                        biome = Biome.HotDesert
                    } else if (precipitation < PRECIP_MED_LOW) {
                        biome = Biome.HotSavanna
                    } else if (precipitation < PRECIP_MED) {
                        biome = Biome.TropicalFrontier
                    } else if (precipitation < PRECIP_HIGH) {
                        biome = Biome.TropicalForest
                    } else {
                        biome = Biome.TropicalRainforest
                    }
                }
                else {
                    if (precipitation < PRECIP_LOW) {
                        biome = Biome.TemperateDesert
                    } else if (precipitation < PRECIP_MED_LOW) {
                        biome = Biome.TemperateGrassland
                    } else if (precipitation < PRECIP_MED) {
                        biome = Biome.TemperateFrontier
                    } else if (precipitation < PRECIP_HIGH) {
                        biome = Biome.TemperateForest
                    } else {
                        biome = Biome.TemperateRainforest
                    }
                }
                
                this.biome[idx] = biome
            }
        }
    }

    private generateRadialGradient(centerX: number, centerY: number, radius: number, centerValue: number, edgeValue: number): Float32Array {
        const output = new Float32Array(this.worldSize * this.worldSize)
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

    private generateLinearGradient(startValue: number, endValue: number): Float32Array {
        const output = new Float32Array(this.worldSize * this.worldSize)
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

    private generateFractalNoise(seed: number, octaves: number): Float32Array {
        const output = new Float32Array(this.worldSize * this.worldSize)
        const noise = new PerlinNoise(seed)
        
        // Cache-optimized tiled processing
        const TILE_SIZE = 4
        
        for (let ty = 0; ty < this.worldSize; ty += TILE_SIZE) {
            for (let tx = 0; tx < this.worldSize; tx += TILE_SIZE) {
                const maxY = Math.min(ty + TILE_SIZE, this.worldSize)
                const maxX = Math.min(tx + TILE_SIZE, this.worldSize)
                
                for (let y = ty; y < maxY; y++) {
                    for (let x = tx; x < maxX; x++) {
                        const idx = this.worldToTileIndex(x, y)
                        
                        let total = 0
                        for (let i = 0; i < octaves && i < FRACTAL_OCTAVES; i++) {
                            // Scale frequency and add per-octave offset to avoid grid alignment
                            const freq = FRACTAL_FREQUENCIES[i]
                            const offsetPerOctave = 0.5 / freq
                            const sampleX = (x + offsetPerOctave) * freq
                            const sampleY = (y + offsetPerOctave) * freq
                            total += noise.noise(sampleX, sampleY) * FRACTAL_WEIGHTS[i]
                        }
                        
                        output[idx] = total
                    }
                }
            }
        }
        
        return output
    }

    private weightedMean(output: Float32Array, mapA: Float32Array, mapB: Float32Array, weight: number): void {
        const invWeight = 1.0 / weight
        
        for (let i = 0; i < mapA.length; i++) {
            output[i] = ((mapA[i] * weight) + (mapB[i] * invWeight)) * 0.5
        }
    }

    private subtract(mapA: Float32Array, mapB: Float32Array): Float32Array {
        const output = new Float32Array(mapA.length)
        
        for (let i = 0; i < mapA.length; i++) {
            output[i] = mapA[i] - mapB[i]
        }
        
        return output
    }

    private applyRiverToMap(path: Array<{ x: number; y: number }>) {
        if (path.length === 0) return
        
        for (let i = 0; i < path.length; i++) {
            const x = path[i].x
            const y = path[i].y

            let nextX = x
            let nextY = y
            if (i + 1 < path.length) {
                nextX = path[i + 1].x
                nextY = path[i + 1].y
            }

            const dx = nextX - x
            const dy = nextY - y
            const angle = Math.atan2(dy, dx)
            
            const flowDir = Math.floor(((angle + Math.PI) / (2 * Math.PI)) * 255)

            if (this.inBounds(x, y)) {
                const idx = this.worldToTileIndex(x, y)
                this.flags[idx] |= 1
                this.flowDirection[idx] = flowDir
            }

            for (let dy = -RIVER_WIDTH; dy <= RIVER_WIDTH; dy++) {
                for (let dx = -RIVER_WIDTH; dx <= RIVER_WIDTH; dx++) {
                    const nx = x + dx
                    const ny = y + dy

                    if (!this.inBounds(nx, ny)) continue

                    const nIdx = this.worldToTileIndex(nx, ny)
                    const dist = Math.sqrt(dx * dx + dy * dy)

                    if (dist <= RIVER_WIDTH) {
                        this.flags[nIdx] |= 1
                        if (this.flowDirection[nIdx] === 0) {
                            this.flowDirection[nIdx] = flowDir
                        }

                        if (dist > RIVER_WIDTH - 0.5) {
                            this.flags[nIdx] |= 2
                        }
                    }
                }
            }
        }

        for (let y = 0; y < this.worldSize; y++) {
            for (let x = 0; x < this.worldSize; x++) {
                const idx = this.worldToTileIndex(x, y)

                if (this.flags[idx] & 1) {
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

                    if (isEdge && !(this.flags[idx] & 2)) {
                        const height = this.height[idx]
                        if (height < SEA_LEVEL + 15) {
                            this.biome[idx] = Biome.Beach
                        } else {
                            this.biome[idx] = Biome.TemperateRainforest
                        }
                    }
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
        const idx = y * this.worldSize + x
        return {
            height: this.height[idx],
            biome: this.biome[idx],
            isWater: (this.flags[idx] & 1) !== 0,
            flowDirection: this.flowDirection[idx],
        }
    }

    getWorldSize(): number {
        return this.worldSize
    }

    getRivers(): River[] {
        return this.rivers
    }
    
    getHeightData(): Uint8Array {
        return this.height
    }
    
    getBiomeData(): Uint8Array {
        return this.biome
    }
    
    getFlagsData(): Uint8Array {
        return this.flags
    }
}

// Mersenne Twister RNG (same as before)
class MersenneTwisterRNG {
    private static readonly N = 624
    private static readonly M = 397
    private static readonly MATRIX_A = 0x9908b0df
    private static readonly UPPER_MASK = 0x80000000
    private static readonly LOWER_MASK = 0x7fffffff

    private mt: Uint32Array
    private mti: number

    constructor(seed: number) {
        this.mt = new Uint32Array(MersenneTwisterRNG.N)
        this.mti = MersenneTwisterRNG.N + 1
        this.init(seed >>> 0)
    }

    private init(seed: number): void {
        this.mt[0] = seed >>> 0
        for (this.mti = 1; this.mti < MersenneTwisterRNG.N; this.mti++) {
            const s = this.mt[this.mti - 1] ^ (this.mt[this.mti - 1] >>> 30)
            this.mt[this.mti] = 
                (((((s & 0xffff0000) >>> 16) * 1812433253) << 16) + 
                 (s & 0x0000ffff) * 1812433253 + this.mti) >>> 0
        }
    }

    private next(): number {
        let y: number
        const mag01 = new Uint32Array([0, MersenneTwisterRNG.MATRIX_A])

        if (this.mti >= MersenneTwisterRNG.N) {
            let kk: number

            for (kk = 0; kk < MersenneTwisterRNG.N - MersenneTwisterRNG.M; kk++) {
                y = (this.mt[kk] & MersenneTwisterRNG.UPPER_MASK) | 
                    (this.mt[kk + 1] & MersenneTwisterRNG.LOWER_MASK)
                this.mt[kk] = this.mt[kk + MersenneTwisterRNG.M] ^ (y >>> 1) ^ mag01[y & 0x1]
            }

            for (; kk < MersenneTwisterRNG.N - 1; kk++) {
                y = (this.mt[kk] & MersenneTwisterRNG.UPPER_MASK) | 
                    (this.mt[kk + 1] & MersenneTwisterRNG.LOWER_MASK)
                this.mt[kk] = this.mt[kk + (MersenneTwisterRNG.M - MersenneTwisterRNG.N)] ^ 
                              (y >>> 1) ^ mag01[y & 0x1]
            }

            y = (this.mt[MersenneTwisterRNG.N - 1] & MersenneTwisterRNG.UPPER_MASK) | 
                (this.mt[0] & MersenneTwisterRNG.LOWER_MASK)
            this.mt[MersenneTwisterRNG.N - 1] = this.mt[MersenneTwisterRNG.M - 1] ^ 
                                              (y >>> 1) ^ mag01[y & 0x1]

            this.mti = 0
        }

        y = this.mt[this.mti++]

        y ^= y >>> 11
        y ^= (y << 7) & 0x9d2c5680
        y ^= (y << 15) & 0xefc60000
        y ^= y >>> 18

        return y >>> 0
    }

    random(): number {
        return this.next() / 0xffffffff
    }
}