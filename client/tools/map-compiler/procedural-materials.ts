import { deflateSync } from 'node:zlib'
/** Deterministic original seamless surface maps, embedded in the compiled GLB. */
function crc(bytes: Uint8Array): number {
    let c = 0xffffffff
    for (const b of bytes) {
        c ^= b
        for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0)
    }
    return (c ^ 0xffffffff) >>> 0
}
function chunk(name: string, data: Uint8Array): Buffer {
    const type = Buffer.from(name),
        out = Buffer.alloc(data.length + 12)
    out.writeUInt32BE(data.length)
    type.copy(out, 4)
    Buffer.from(data).copy(out, 8)
    out.writeUInt32BE(crc(Buffer.concat([type, data])), 8 + data.length)
    return out
}
function png(data: Uint8Array, n: number): string {
    const header = Buffer.alloc(13)
    header.writeUInt32BE(n)
    header.writeUInt32BE(n, 4)
    header[8] = 8
    header[9] = 6
    const scan = Buffer.alloc(n * (n * 4 + 1))
    for (let y = 0; y < n; y++)
        Buffer.from(data.subarray(y * n * 4, (y + 1) * n * 4)).copy(
            scan,
            y * (n * 4 + 1) + 1
        )
    return (
        'data:image/png;base64,' +
        Buffer.concat([
            Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
            chunk('IHDR', header),
            chunk('IDAT', deflateSync(scan)),
            chunk('IEND', new Uint8Array()),
        ]).toString('base64')
    )
}
export function surfaceMaps(name: string): {
    albedo: string
    normal: string
    orm: string
} {
    const n = 256,
        albedo = new Uint8Array(n * n * 4),
        normal = new Uint8Array(n * n * 4),
        orm = new Uint8Array(n * n * 4),
        height = new Float32Array(n * n)
    let seed =
        Array.from(name).reduce(
            (v, c) => Math.imul(v, 31) + c.charCodeAt(0),
            193
        ) >>> 0
    const rnd = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
        return seed / 4294967296
    }
    const grids = [4, 8, 16, 64].map((size) => ({
        size,
        data: Float32Array.from({ length: size * size }, rnd),
    }))
    const noise = (x: number, y: number, index: number) => {
        const { size, data } = grids[index],
            u = (x / n) * size,
            v = (y / n) * size,
            ix = Math.floor(u),
            iy = Math.floor(v),
            fx = u - ix,
            fy = v - iy,
            sx = fx * fx * (3 - 2 * fx),
            sy = fy * fy * (3 - 2 * fy)
        const a = data[iy * size + ix],
            b = data[iy * size + ((ix + 1) % size)],
            c = data[((iy + 1) % size) * size + ix],
            d = data[((iy + 1) % size) * size + ((ix + 1) % size)]
        return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy
    }
    for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++)
            height[y * n + x] = noise(x, y, 2) * 0.06 + rnd() * 0.035
    for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
            const i = (y * n + x) * 4,
                h = height[y * n + x],
                brick = name.includes('brick'),
                metal = /rust|steel|paint/.test(name),
                mortar =
                    brick &&
                    (y % 32 < 2 || (x + (Math.floor(y / 32) % 2) * 32) % 64 < 2)
            const patch = noise(x, y, 0) * 0.65 + noise(x, y, 1) * 0.35
            const v = mortar ? 0.67 : 0.78 + patch * 0.18 + h * 0.35
            const rust = metal && patch > 0.6
            albedo.set(
                [
                    255 * v,
                    255 * v * (rust ? 0.8 : 1),
                    255 * v * (rust ? 0.63 : 1),
                    255,
                ],
                i
            )
            const dx =
                    height[y * n + ((x + 1) % n)] -
                    height[y * n + ((x + n - 1) % n)],
                dy =
                    height[((y + 1) % n) * n + x] -
                    height[((y + n - 1) % n) * n + x]
            normal.set([128 - dx * 80, 128 - dy * 80, 255, 255], i)
            orm.set(
                [
                    mortar ? 220 : 255,
                    metal ? 170 + patch * 50 : 235,
                    metal ? (rust ? 70 : 240) : 0,
                    255,
                ],
                i
            )
        }
    return { albedo: png(albedo, n), normal: png(normal, n), orm: png(orm, n) }
}
