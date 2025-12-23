import { PerlinNoise } from './utils/PerlinNoise'

export enum Biome {
    Ocean = 0,
    Beach,
    Plains,
    Forest,
    Desert,
    Snow,
    Mountain,
    Swamp,
}

export interface Tile {
    height: number // 0-255
    biome: Biome
    isWater: boolean
}

export interface River {
    path: Array<{ x: number; y: number }>
}

const SEA_LEVEL = 90
const BEACH_LEVEL = 100
const MOUNTAIN_LEVEL = 210

export class TerrainGenerator {
    private seed: number
    private worldSize: number
    private heightNoise: PerlinNoise
    private moistureNoise: PerlinNoise
    private temperatureNoise: PerlinNoise
    private tiles: Tile[] = []
    private rivers: River[] = []

    constructor(seed: number, worldSize: number) {
        this.seed = seed
        this.worldSize = worldSize

        // Initialize noise generators with different seeds
        this.heightNoise = new PerlinNoise(seed)
        this.moistureNoise = new PerlinNoise(seed + 1)
        this.temperatureNoise = new PerlinNoise(seed + 2)

        this.tiles = new Array(worldSize * worldSize)
    }

    generate(rivers: River[]) {
        this.rivers = rivers
        this.generateHeightmap()
        this.generateBiomes()
        this.applyRivers()
    }

    private generateHeightmap() {
        for (let y = 0; y < this.worldSize; y++) {
            for (let x = 0; x < this.worldSize; x++) {
                const idx = y * this.worldSize + x

                // Get fractal noise with 3 octaves to match server
                let h = this.heightNoise.fractal(x * 0.002, y * 0.002, 3, 0.5)

                // Normalize from [-1, 1] to [0, 1]
                h = h * 0.5 + 0.5
                h = Math.max(0, Math.min(1, h))

                const height = Math.floor(h * 255)

                this.tiles[idx] = {
                    height,
                    biome: Biome.Plains,
                    isWater: false,
                }
            }
        }
    }

    private generateBiomes() {
        for (let y = 0; y < this.worldSize; y++) {
            for (let x = 0; x < this.worldSize; x++) {
                const idx = y * this.worldSize + x
                const tile = this.tiles[idx]
                const h = tile.height

                const m =
                    this.moistureNoise.noise(x * 0.005, y * 0.005) * 0.5 + 0.5
                const t =
                    this.temperatureNoise.noise(x * 0.003, y * 0.003) * 0.5 +
                    0.5

                let biome: Biome

                if (h < SEA_LEVEL) {
                    biome = Biome.Ocean
                    tile.isWater = true
                } else if (h < BEACH_LEVEL) {
                    biome = Biome.Beach
                } else if (h > MOUNTAIN_LEVEL) {
                    biome = Biome.Mountain
                } else if (t < 0.3) {
                    biome = Biome.Snow
                } else if (m > 0.7) {
                    biome = Biome.Forest
                } else if (t > 0.7 && m < 0.3) {
                    biome = Biome.Desert
                } else if (m > 0.5 && h < 120) {
                    biome = Biome.Swamp
                } else {
                    biome = Biome.Plains
                }

                tile.biome = biome
            }
        }
    }

    private applyRivers() {
        for (const river of this.rivers) {
            for (const point of river.path) {
                if (
                    point.x >= 0 &&
                    point.x < this.worldSize &&
                    point.y >= 0 &&
                    point.y < this.worldSize
                ) {
                    const idx = point.y * this.worldSize + point.x
                    this.tiles[idx].isWater = true
                }
            }
        }
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
