import { describe, expect, it } from 'vitest'
import { parseCollisionMesh } from '../src/foundation/assets/CollisionMesh'

function collisionBuffer(overrides: { version?: number; flags?: number; indices?: number[] } = {}): Uint8Array {
    const indices = overrides.indices ?? [0, 1, 2]
    const output = new Uint8Array(40 + 36 + indices.length * 4)
    const view = new DataView(output.buffer)
    output.set([0x4d, 0x33, 0x43, 0x4c])
    view.setUint16(4, overrides.version ?? 1, true)
    view.setUint16(6, overrides.flags ?? 0, true)
    view.setUint32(8, 3, true)
    view.setUint32(12, indices.length, true)
    ;[0, 0, 0, 1, 1, 1].forEach((value, index) => view.setFloat32(16 + index * 4, value, true))
    ;[0, 0, 0, 1, 0, 0, 0, 0, 1].forEach((value, index) => view.setFloat32(40 + index * 4, value, true))
    indices.forEach((value, index) => view.setUint32(76 + index * 4, value, true))
    return output
}

describe('M3CL collision reader', () => {
    it('reads a complete little-endian triangle mesh', () => {
        const parsed = parseCollisionMesh(collisionBuffer())
        expect([...parsed.vertices]).toEqual([0, 0, 0, 1, 0, 0, 0, 0, 1])
        expect([...parsed.indices]).toEqual([0, 1, 2])
    })

    it('rejects truncation and trailing data', () => {
        const complete = collisionBuffer()
        expect(() => parseCollisionMesh(complete.subarray(0, complete.length - 1))).toThrow(/truncated/)
        const trailing = new Uint8Array(complete.length + 1); trailing.set(complete)
        expect(() => parseCollisionMesh(trailing)).toThrow(/trailing/)
    })

    it('rejects unknown versions, flags, incomplete triangles, and bad indices', () => {
        expect(() => parseCollisionMesh(collisionBuffer({ version: 2 }))).toThrow(/version/)
        expect(() => parseCollisionMesh(collisionBuffer({ flags: 1 }))).toThrow(/flags/)
        expect(() => parseCollisionMesh(collisionBuffer({ indices: [0, 1] }))).toThrow(/complete triangles/)
        expect(() => parseCollisionMesh(collisionBuffer({ indices: [0, 1, 3] }))).toThrow(/references vertex/)
    })
})
