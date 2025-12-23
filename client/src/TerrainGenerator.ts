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
    flowDirection: number // 0-255 representing 0-360 degrees
}

export interface River {
    path: Array<{ x: number; y: number }>
}

const SEA_LEVEL = 90
const BEACH_LEVEL = 100
const MOUNTAIN_LEVEL = 210
const RIVER_WIDTH = 3
const NUM_RIVERS = 15

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

    constructor(seed: number, worldSize: number) {
        this.seed = seed
        this.worldSize = worldSize

        // Initialize noise generators with different seeds
        this.heightNoise = new PerlinNoise(seed)
        this.moistureNoise = new PerlinNoise(seed + 1)
        this.temperatureNoise = new PerlinNoise(seed + 2)

        this.tiles = new Array(worldSize * worldSize)
        this.height = new Array(worldSize * worldSize)
        this.biome = new Array(worldSize * worldSize)
        this.flags = new Array(worldSize * worldSize).fill(0)
        this.flowDirection = new Array(worldSize * worldSize).fill(0)
    }

    generate(rivers?: Array<{path: Array<{x: number, y: number}>}>) {
        this.generateHeightmap()
        this.generateBiomes()
        
        if (rivers) {
            // Use server-provided river data
            console.log('Using server river data:', rivers.length, 'rivers')
            this.rivers = rivers
            for (const river of rivers) {
                this.applyRiverToMap(river.path)
            }
        } else {
            // Generate rivers client-side (fallback)
            this.generateRivers()
        }
        
        this.buildTiles()
    }

    private generateHeightmap() {
        // Multi-layer noise for organic island generation
        // Create noise generators with offset seeds for variety
        const noiseA = new PerlinNoise(this.seed)
        const noiseA2 = new PerlinNoise(this.seed + 1)
        const noiseB = new PerlinNoise(this.seed + 2)
        const noiseB2 = new PerlinNoise(this.seed + 3)
        const noiseC = new PerlinNoise(this.seed + 4)
        const noiseC2 = new PerlinNoise(this.seed + 5)
        
        // Pre-compute constants for efficiency
        const centerX = this.worldSize * 0.5
        const centerY = this.worldSize * 0.5
        const islandRadius = this.worldSize * 0.5
        const islandRadiusSquared = islandRadius * islandRadius
        const invRadiusSquared = 1.0 / islandRadiusSquared
        
        // Frequency divisors for noise sampling
        const freq64 = 1.0 / 64.0
        const freq100 = 1.0 / 100.0
        const freq216 = 1.0 / 216.0
        
        for (let y = 0; y < this.worldSize; y++) {
            for (let x = 0; x < this.worldSize; x++) {
                const idx = this.worldToTileIndex(x, y)

                // Sample 6 noise layers at different frequencies
                // Each returns [-1, 1], normalize to [0, 255]
                const n1 = (noiseA.noise(x * freq64, y * freq64) * 0.5 + 0.5) * 255
                const n2 = (noiseA2.noise(x * freq64, y * freq64) * 0.5 + 0.5) * 255
                const n3 = (noiseB.noise(x * freq100, y * freq100) * 0.5 + 0.5) * 255
                const n4 = (noiseB2.noise(x * freq100, y * freq100) * 0.5 + 0.5) * 255
                const n5 = (noiseC.noise(x * freq216, y * freq216) * 0.5 + 0.5) * 255
                const n6 = (noiseC2.noise(x * freq216, y * freq216) * 0.5 + 0.5) * 255
                
                // Average all noise layers
                const noiseAvg = (n1 + n2 + n3 + n4 + n5 + n6) * 0.166666667 // 1/6
                
                // Compute spherical gradient (avoid sqrt by using squared distance)
                const dx = x - centerX
                const dy = y - centerY
                const distSquared = dx * dx + dy * dy
                
                // Invert gradient: center high, edges low
                let sphereGrad = 255 - (distSquared * invRadiusSquared * 255)
                sphereGrad = Math.max(0, Math.min(255, sphereGrad))
                
                // Blend noise with gradient (50/50 mix)
                const finalHeight = (noiseAvg + sphereGrad) * 0.5

                const height = Math.floor(Math.max(0, Math.min(255, finalHeight)))
                this.height[idx] = height
            }
        }
    }

    private generateBiomes() {
        for (let y = 0; y < this.worldSize; y++) {
            for (let x = 0; x < this.worldSize; x++) {
                const idx = this.worldToTileIndex(x, y)
                const h = this.height[idx]

                const m =
                    this.moistureNoise.noise(x * 0.005, y * 0.005) * 0.5 + 0.5
                const t =
                    this.temperatureNoise.noise(x * 0.003, y * 0.003) * 0.5 +
                    0.5

                let biome: Biome

                if (h < SEA_LEVEL) {
                    biome = Biome.Ocean
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

                this.biome[idx] = biome
            }
        }
    }

    private generateRivers() {
        const rng = this.seededRandom(this.seed)

        for (let i = 0; i < NUM_RIVERS; i++) {
            // Find a high elevation starting point
            let startX = 0
            let startY = 0
            let attempts = 0
            do {
                startX = Math.floor(rng() * this.worldSize)
                startY = Math.floor(rng() * this.worldSize)
                attempts++
            } while (this.height[this.worldToTileIndex(startX, startY)] < 130 && attempts < 2000)

            if (attempts >= 2000) continue

            const path: Array<{ x: number; y: number }> = []
            const visited = new Set<string>()
            let x = startX
            let y = startY

            // Flow downhill
            while (this.inBounds(x, y) && this.height[this.worldToTileIndex(x, y)] >= SEA_LEVEL) {
                const key = `${x},${y}`
                if (visited.has(key)) break
                visited.add(key)

                path.push({ x, y })

                const [nextX, nextY] = this.findLowestNeighbor(x, y)

                // If stuck, try to dig through slightly
                if (nextX === x && nextY === y) {
                    const currentHeight = this.height[this.worldToTileIndex(x, y)]
                    let found = false
                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dx = -1; dx <= 1; dx++) {
                            const nx = x + dx
                            const ny = y + dy
                            if (this.inBounds(nx, ny)) {
                                const neighborHeight = this.height[this.worldToTileIndex(nx, ny)]
                                if (neighborHeight < currentHeight + 5) {
                                    x = nx
                                    y = ny
                                    found = true
                                    break
                                }
                            }
                        }
                        if (found) break
                    }
                    if (!found) break
                } else {
                    x = nextX
                    y = nextY
                }

                if (path.length > 2000) break
            }

            if (path.length > 10) {
                this.rivers.push({ path })
                this.applyRiverToMap(path)
            }
        }
    }

    private applyRiverToMap(path: Array<{ x: number; y: number }>) {
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

            // Convert angle [-π, π] to 0-255 range (0 = -π, 128 = 0, 255 = π)
            const flowDir = Math.round(((angle + Math.PI) / (2 * Math.PI)) * 255) & 0xFF

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
                        if (height < SEA_LEVEL + 15) {
                            this.biome[idx] = Biome.Beach
                        } else {
                            this.biome[idx] = Biome.Swamp
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

    private findLowestNeighbor(x: number, y: number): [number, number] {
        const dx = [-1, 0, 1, -1, 1, -1, 0, 1]
        const dy = [-1, -1, -1, 0, 0, 1, 1, 1]

        let bestX = x
        let bestY = y
        let lowestHeight = this.height[this.worldToTileIndex(x, y)]

        for (let i = 0; i < 8; i++) {
            const nx = x + dx[i]
            const ny = y + dy[i]

            if (!this.inBounds(nx, ny)) continue

            const h = this.height[this.worldToTileIndex(nx, ny)]
            if (h < lowestHeight) {
                lowestHeight = h
                bestX = nx
                bestY = ny
            }
        }

        return [bestX, bestY]
    }

    private inBounds(x: number, y: number): boolean {
        return x >= 0 && x < this.worldSize && y >= 0 && y < this.worldSize
    }

    private worldToTileIndex(x: number, y: number): number {
        return y * this.worldSize + x
    }

    private seededRandom(seed: number) {
        let value = seed
        return () => {
            value = (value * 9301 + 49297) % 233280
            return value / 233280
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
