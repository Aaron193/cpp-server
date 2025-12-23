/**
 * Simple Perlin noise implementation for deterministic terrain generation
 * Based on improved Perlin noise algorithm
 */
export class PerlinNoise {
    private permutation: number[] = []
    private p: number[] = []

    constructor(seed: number) {
        // Generate permutation table from seed
        this.permutation = this.generatePermutation(seed)
        
        // Duplicate for overflow handling
        this.p = new Array(512)
        for (let i = 0; i < 256; i++) {
            this.p[i] = this.permutation[i]
            this.p[256 + i] = this.permutation[i]
        }
    }

    private generatePermutation(seed: number): number[] {
        const p = []
        for (let i = 0; i < 256; i++) {
            p[i] = i
        }

        // Shuffle using seed-based random
        let random = this.seededRandom(seed)
        for (let i = 255; i > 0; i--) {
            const j = Math.floor(random() * (i + 1))
            ;[p[i], p[j]] = [p[j], p[i]]
        }

        return p
    }

    private seededRandom(seed: number): () => number {
        let state = seed
        return () => {
            state = (state * 9301 + 49297) % 233280
            return state / 233280
        }
    }

    private fade(t: number): number {
        return t * t * t * (t * (t * 6 - 15) + 10)
    }

    private lerp(t: number, a: number, b: number): number {
        return a + t * (b - a)
    }

    private grad(hash: number, x: number, y: number): number {
        const h = hash & 15
        const u = h < 8 ? x : y
        const v = h < 4 ? y : h === 12 || h === 14 ? x : 0
        return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v)
    }

    /**
     * Get 2D Perlin noise value at given coordinates
     * @param x X coordinate
     * @param y Y coordinate
     * @returns Value between -1 and 1
     */
    noise(x: number, y: number): number {
        const X = Math.floor(x) & 255
        const Y = Math.floor(y) & 255

        x -= Math.floor(x)
        y -= Math.floor(y)

        const u = this.fade(x)
        const v = this.fade(y)

        const a = this.p[X] + Y
        const aa = this.p[a]
        const ab = this.p[a + 1]
        const b = this.p[X + 1] + Y
        const ba = this.p[b]
        const bb = this.p[b + 1]

        return this.lerp(
            v,
            this.lerp(u, this.grad(this.p[aa], x, y), this.grad(this.p[ba], x - 1, y)),
            this.lerp(u, this.grad(this.p[ab], x, y - 1), this.grad(this.p[bb], x - 1, y - 1))
        )
    }

    /**
     * Get fractal Perlin noise with multiple octaves
     * @param x X coordinate
     * @param y Y coordinate
     * @param octaves Number of octaves
     * @param persistence How much each octave contributes
     * @returns Value between -1 and 1
     */
    fractal(x: number, y: number, octaves: number = 3, persistence: number = 0.5): number {
        let total = 0
        let frequency = 1
        let amplitude = 1
        let maxValue = 0

        for (let i = 0; i < octaves; i++) {
            total += this.noise(x * frequency, y * frequency) * amplitude
            maxValue += amplitude
            amplitude *= persistence
            frequency *= 2
        }

        return total / maxValue
    }
}
