export interface CollisionBounds {
    readonly min: readonly [number, number, number]
    readonly max: readonly [number, number, number]
}

export interface CollisionMeshData {
    readonly formatVersion: 1
    readonly bounds: CollisionBounds
    readonly vertices: Float32Array
    readonly indices: Uint32Array
}

const HEADER_BYTES = 40
const MAGIC = [0x4d, 0x33, 0x43, 0x4c] as const

/** Strict reader for the deterministic M3CL v1 static-triangle format. */
export function parseCollisionMesh(input: ArrayBuffer | ArrayBufferView): CollisionMeshData {
    const bytes = input instanceof ArrayBuffer
        ? new Uint8Array(input)
        : new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
    if (bytes.byteLength < HEADER_BYTES) throw new RangeError('Collision data is truncated before its header')
    if (MAGIC.some((byte, index) => bytes[index] !== byte)) throw new TypeError('Invalid collision magic; expected M3CL')

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const version = view.getUint16(4, true)
    if (version !== 1) throw new TypeError(`Unsupported collision version: ${version}`)
    const flags = view.getUint16(6, true)
    if (flags !== 0) throw new TypeError(`Unsupported collision flags: ${flags}`)

    const vertexCount = view.getUint32(8, true)
    const indexCount = view.getUint32(12, true)
    if (vertexCount < 3) throw new TypeError('Collision mesh requires at least three vertices')
    if (indexCount === 0 || indexCount % 3 !== 0) throw new TypeError('Collision index count must contain complete triangles')
    const expectedBytes = HEADER_BYTES + vertexCount * 12 + indexCount * 4
    if (!Number.isSafeInteger(expectedBytes) || bytes.byteLength !== expectedBytes) {
        throw new RangeError(bytes.byteLength < expectedBytes
            ? `Collision data is truncated: expected ${expectedBytes} bytes, found ${bytes.byteLength}`
            : `Collision data has trailing bytes: expected ${expectedBytes} bytes, found ${bytes.byteLength}`)
    }

    const boundsValues = Array.from({ length: 6 }, (_, index) => view.getFloat32(16 + index * 4, true))
    if (!boundsValues.every(Number.isFinite)) throw new TypeError('Collision bounds contain non-finite values')
    const min = boundsValues.slice(0, 3) as [number, number, number]
    const max = boundsValues.slice(3, 6) as [number, number, number]
    if (min.some((value, axis) => value > max[axis])) throw new TypeError('Collision bounds minimum exceeds maximum')

    const vertices = new Float32Array(vertexCount * 3)
    let offset = HEADER_BYTES
    for (let index = 0; index < vertices.length; index++, offset += 4) {
        const value = view.getFloat32(offset, true)
        if (!Number.isFinite(value)) throw new TypeError(`Collision vertex ${Math.floor(index / 3)} is non-finite`)
        vertices[index] = value
    }
    const indices = new Uint32Array(indexCount)
    for (let index = 0; index < indices.length; index++, offset += 4) {
        const value = view.getUint32(offset, true)
        if (value >= vertexCount) throw new RangeError(`Collision index ${index} references vertex ${value}, but vertex count is ${vertexCount}`)
        indices[index] = value
    }

    return { formatVersion: 1, bounds: { min, max }, vertices, indices }
}

export async function loadCollisionMesh(url: string, fetcher: typeof fetch = fetch): Promise<CollisionMeshData> {
    const response = await fetcher(url)
    if (!response.ok) throw new Error(`Unable to load collision data (${response.status})`)
    return parseCollisionMesh(await response.arrayBuffer())
}
