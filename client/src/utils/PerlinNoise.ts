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

        // Shuffle using Mersenne Twister (matching C++ std::mt19937)
        const mt = new MersenneTwister(seed)
        
        // Fisher-Yates shuffle
        for (let i = 255; i > 0; i--) {
            const j = Math.floor(mt.random() * (i + 1))
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


// TODO: just implement this or somethign different on C++ too so we can match 100% the same

// Matches C++ std::mt19937 behavior
class MersenneTwister {
    private static readonly N = 624
    private static readonly M = 397
    private static readonly MATRIX_A = 0x9908b0df
    private static readonly UPPER_MASK = 0x80000000
    private static readonly LOWER_MASK = 0x7fffffff

    private mt: Uint32Array
    private mti: number

    constructor(seed: number) {
        this.mt = new Uint32Array(MersenneTwister.N)
        this.mti = MersenneTwister.N + 1
        this.init(seed >>> 0)
    }

    private init(seed: number): void {
        this.mt[0] = seed >>> 0
        for (this.mti = 1; this.mti < MersenneTwister.N; this.mti++) {
            const s = this.mt[this.mti - 1] ^ (this.mt[this.mti - 1] >>> 30)
            this.mt[this.mti] = 
                (((((s & 0xffff0000) >>> 16) * 1812433253) << 16) + 
                 (s & 0x0000ffff) * 1812433253 + this.mti) >>> 0
        }
    }

    private next(): number {
        let y: number
        const mag01 = new Uint32Array([0, MersenneTwister.MATRIX_A])

        if (this.mti >= MersenneTwister.N) {
            let kk: number

            for (kk = 0; kk < MersenneTwister.N - MersenneTwister.M; kk++) {
                y = (this.mt[kk] & MersenneTwister.UPPER_MASK) | 
                    (this.mt[kk + 1] & MersenneTwister.LOWER_MASK)
                this.mt[kk] = this.mt[kk + MersenneTwister.M] ^ (y >>> 1) ^ mag01[y & 0x1]
            }

            for (; kk < MersenneTwister.N - 1; kk++) {
                y = (this.mt[kk] & MersenneTwister.UPPER_MASK) | 
                    (this.mt[kk + 1] & MersenneTwister.LOWER_MASK)
                this.mt[kk] = this.mt[kk + (MersenneTwister.M - MersenneTwister.N)] ^ 
                              (y >>> 1) ^ mag01[y & 0x1]
            }

            y = (this.mt[MersenneTwister.N - 1] & MersenneTwister.UPPER_MASK) | 
                (this.mt[0] & MersenneTwister.LOWER_MASK)
            this.mt[MersenneTwister.N - 1] = this.mt[MersenneTwister.M - 1] ^ 
                                              (y >>> 1) ^ mag01[y & 0x1]

            this.mti = 0
        }

        y = this.mt[this.mti++]

        // Tempering
        y ^= y >>> 11
        y ^= (y << 7) & 0x9d2c5680
        y ^= (y << 15) & 0xefc60000
        y ^= y >>> 18

        return y >>> 0
    }

    random(): number {
        return this.next() / 0xffffffff
    }

    randomInt(max: number): number {
        return Math.floor(this.random() * max)
    }
}