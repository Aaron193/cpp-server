// Cross-platform compatible Perlin Noise
// Uses same algorithm as C++ for deterministic generation

export class PerlinNoise {
    private permutation: Uint8Array = new Uint8Array(256)

    constructor(seed: number) {
        this.generatePermutation(seed)
    }

    private generatePermutation(seed: number): void {
        // Initialize permutation table with values 0-255
        const p = new Uint8Array(256)
        for (let i = 0; i < 256; i++) {
            p[i] = i
        }

        // Shuffle using seeded random
        const rng = new XorShift32(seed)

        // Fisher-Yates shuffle
        for (let i = 255; i > 0; i--) {
            const j = rng.randomInt(i + 1)
            const temp = p[i]
            p[i] = p[j]
            p[j] = temp
        }

        // Optimized: Single 256 array with masking
        this.permutation = p
    }

    private fade(t: number): number {
        // 6t^5 - 15t^4 + 10t^3
        return t * t * t * (t * (t * 6.0 - 15.0) + 10.0)
    }

    private lerp(t: number, a: number, b: number): number {
        return a + t * (b - a)
    }

    private grad(hash: number, x: number, y: number): number {
        // Convert hash to one of 16 gradient directions
        const h = hash & 15
        const u = h < 8 ? x : y
        const v = h < 4 ? y : (h === 12 || h === 14 ? x : 0.0)
        return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v)
    }

    noise(x: number, y: number): number {
        // Find unit square that contains point
        const X = Math.floor(x) & 255
        const Y = Math.floor(y) & 255

        // Find relative x, y in square
        x -= Math.floor(x)
        y -= Math.floor(y)

        // Compute fade curves
        const u = this.fade(x)
        const v = this.fade(y)

        // Hash coordinates of the 4 square corners
        // Optimized: Use masking instead of duplicate array
        const aa = this.permutation[(this.permutation[X] + Y) & 255]
        const ab = this.permutation[(this.permutation[X] + Y + 1) & 255]
        const ba = this.permutation[(this.permutation[X + 1] + Y) & 255]
        const bb = this.permutation[(this.permutation[X + 1] + Y + 1) & 255]

        // Blend results from the 4 corners
        const x1 = this.lerp(u, this.grad(aa, x, y), this.grad(ba, x - 1.0, y))
        const x2 = this.lerp(u, this.grad(ab, x, y - 1.0), this.grad(bb, x - 1.0, y - 1.0))

        return this.lerp(v, x1, x2)
    }

    fractal(x: number, y: number, octaves: number, persistence: number): number {
        let total = 0.0
        let frequency = 1.0
        let amplitude = 1.0
        let maxValue = 0.0

        for (let i = 0; i < octaves; i++) {
            total += this.noise(x * frequency, y * frequency) * amplitude
            maxValue += amplitude
            amplitude *= persistence
            frequency *= 2.0
        }

        return total / maxValue
    }
}


// Lightweight xorshift RNG shared with server implementation
class XorShift32 {
    private state: number

    constructor(seed: number) {
        const s = seed >>> 0
        this.state = s === 0 ? 0x6d2b79f5 : s
    }

    private nextUint32(): number {
        let x = this.state
        x ^= x << 13
        x ^= x >>> 17
        x ^= x << 5
        this.state = x >>> 0
        return this.state
    }

    randomInt(maxExclusive: number): number {
        if (maxExclusive <= 0) return 0
        return this.nextUint32() % maxExclusive
    }
}