import { canonicalJson, prettyJson, sha256 } from './canonical'
import { MapCompileError, type CompiledMap, type MapManifest, type TriangleMesh, type Vec3, type WorldBounds } from './types'
import type { ParsedMapSource } from './gltf'

const AREA_EPSILON_SQUARED = 1e-12

function inside(point: Vec3, bounds: WorldBounds): boolean {
    return point.every((entry, index) => entry >= bounds.min[index] && entry <= bounds.max[index])
}

function validateMeshes(meshes: readonly TriangleMesh[], bounds: WorldBounds, label: string): void {
    for (const mesh of meshes) {
        if (mesh.indices.length === 0 || mesh.indices.length % 3 !== 0) throw new MapCompileError(`${label} ${mesh.name} must contain complete triangles`)
        for (const [index, point] of mesh.positions.entries()) {
            if (!point.every(Number.isFinite)) throw new MapCompileError(`${label} ${mesh.name} vertex ${index} is non-finite`)
            if (!inside(point, bounds)) throw new MapCompileError(`${label} ${mesh.name} vertex ${index} is outside world bounds`)
        }
        for (let i = 0; i < mesh.indices.length; i += 3) {
            const ids = [mesh.indices[i], mesh.indices[i + 1], mesh.indices[i + 2]]
            if (ids.some((id) => !Number.isInteger(id) || id < 0 || id >= mesh.positions.length)) throw new MapCompileError(`${label} ${mesh.name} triangle ${i / 3} has an invalid index`)
            const [a, b, c] = ids.map((id) => mesh.positions[id])
            const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
            const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
            const cross = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]]
            if (cross[0] ** 2 + cross[1] ** 2 + cross[2] ** 2 <= AREA_EPSILON_SQUARED) throw new MapCompileError(`${label} ${mesh.name} triangle ${i / 3} is degenerate`)
        }
    }
}

function align4(length: number): number { return (length + 3) & ~3 }

function buildSceneGlb(meshes: readonly TriangleMesh[]): Uint8Array {
    const binaryParts: Uint8Array[] = [], bufferViews: object[] = [], accessors: object[] = [], gltfMeshes: object[] = [], nodes: object[] = []
    let byteOffset = 0
    const append = (data: Uint8Array, target?: number): number => {
        const aligned = align4(data.byteLength)
        const padded = new Uint8Array(aligned); padded.set(data)
        const index = bufferViews.length
        bufferViews.push({ buffer: 0, byteOffset, byteLength: data.byteLength, ...(target ? { target } : {}) })
        binaryParts.push(padded); byteOffset += aligned
        return index
    }
    for (const mesh of [...meshes].sort((a, b) => a.name.localeCompare(b.name))) {
        const positions = new Float32Array(mesh.positions.flat())
        const indices = new Uint32Array(mesh.indices)
        const positionView = append(new Uint8Array(positions.buffer), 34962)
        const indexView = append(new Uint8Array(indices.buffer), 34963)
        const mins = [0, 1, 2].map((axis) => Math.min(...mesh.positions.map((point) => point[axis])))
        const maxs = [0, 1, 2].map((axis) => Math.max(...mesh.positions.map((point) => point[axis])))
        const positionAccessor = accessors.push({ bufferView: positionView, componentType: 5126, count: mesh.positions.length, type: 'VEC3', min: mins, max: maxs }) - 1
        const indexAccessor = accessors.push({ bufferView: indexView, componentType: 5125, count: mesh.indices.length, type: 'SCALAR' }) - 1
        const meshIndex = gltfMeshes.push({ name: mesh.name, primitives: [{ attributes: { POSITION: positionAccessor }, indices: indexAccessor, material: 0 }] }) - 1
        nodes.push({ name: mesh.name, mesh: meshIndex })
    }
    const json = { asset: { version: '2.0', generator: 'cpp-server-map-compiler/1' }, scene: 0, scenes: [{ nodes: nodes.map((_, index) => index) }], nodes, meshes: gltfMeshes, materials: [{ name: 'Graybox', pbrMetallicRoughness: { baseColorFactor: [0.52, 0.55, 0.58, 1], metallicFactor: 0, roughnessFactor: 0.9 } }], accessors, bufferViews, buffers: [{ byteLength: byteOffset }] }
    const encodedJson = new TextEncoder().encode(canonicalJson(json))
    const jsonLength = align4(encodedJson.byteLength), total = 12 + 8 + jsonLength + 8 + byteOffset
    const output = new Uint8Array(total), view = new DataView(output.buffer)
    view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, total, true)
    view.setUint32(12, jsonLength, true); view.setUint32(16, 0x4e4f534a, true)
    output.fill(0x20, 20, 20 + jsonLength); output.set(encodedJson, 20)
    const binHeader = 20 + jsonLength
    view.setUint32(binHeader, byteOffset, true); view.setUint32(binHeader + 4, 0x004e4942, true)
    let cursor = binHeader + 8
    for (const part of binaryParts) { output.set(part, cursor); cursor += part.byteLength }
    return output
}

function flattenMeshes(meshes: readonly TriangleMesh[]): { vertices: Vec3[]; indices: number[] } {
    const vertices: Vec3[] = [], indices: number[] = []
    for (const mesh of [...meshes].sort((a, b) => a.name.localeCompare(b.name))) {
        const base = vertices.length; vertices.push(...mesh.positions); indices.push(...mesh.indices.map((index) => index + base))
    }
    return { vertices, indices }
}

function buildCollision(meshes: readonly TriangleMesh[], bounds: WorldBounds): Uint8Array {
    const { vertices, indices } = flattenMeshes(meshes)
    const output = new Uint8Array(40 + vertices.length * 12 + indices.length * 4), view = new DataView(output.buffer)
    output.set([0x4d, 0x33, 0x43, 0x4c], 0)
    view.setUint16(4, 1, true); view.setUint16(6, 0, true)
    view.setUint32(8, vertices.length, true); view.setUint32(12, indices.length, true)
    ;[...bounds.min, ...bounds.max].forEach((value, index) => view.setFloat32(16 + index * 4, value, true))
    let offset = 40
    for (const point of vertices) for (const component of point) { view.setFloat32(offset, component, true); offset += 4 }
    for (const index of indices) { view.setUint32(offset, index, true); offset += 4 }
    return output
}

export function compileParsedMap(source: ParsedMapSource): CompiledMap {
    validateMeshes(source.renderMeshes, source.bounds, 'render mesh')
    validateMeshes(source.collisionMeshes, source.bounds, 'collision mesh')
    if (source.spawns.length < 12) throw new MapCompileError(`map requires at least 12 spawns; found ${source.spawns.length}`)
    for (const spawn of source.spawns) {
        if (!inside(spawn.position, source.bounds)) throw new MapCompileError(`spawn ${spawn.id} is outside world bounds`)
        if (!Number.isFinite(spawn.yaw)) throw new MapCompileError(`spawn ${spawn.id} yaw is non-finite`)
    }
    for (const marker of source.markers) if (!inside(marker.position, source.bounds)) throw new MapCompileError(`marker ${marker.id} is outside world bounds`)
    const spawns = [...source.spawns].sort((a, b) => a.id.localeCompare(b.id)), markers = [...source.markers].sort((a, b) => a.id.localeCompare(b.id))
    const scene = buildSceneGlb(source.renderMeshes), collision = buildCollision(source.collisionMeshes, source.bounds)
    const base = { format: 'cpp-server-map' as const, formatVersion: 1 as const, mapId: source.mapId, coordinateSystem: { handedness: 'right' as const, upAxis: 'Y' as const, units: 'meters' as const }, worldBounds: source.bounds, renderAsset: 'scene.glb' as const, collisionAsset: 'collision.bin' as const, debugReport: 'debug-report.json' as const, spawnPoints: spawns, markers }
    const contentHash = sha256([new TextEncoder().encode(canonicalJson(base)), scene, collision])
    const manifest: MapManifest = { ...base, contentHash }
    const debug = { format: 'cpp-server-map-debug', formatVersion: 1, mapId: source.mapId, collision: { meshCount: source.collisionMeshes.length, vertexCount: source.collisionMeshes.reduce((sum, mesh) => sum + mesh.positions.length, 0), triangleCount: source.collisionMeshes.reduce((sum, mesh) => sum + mesh.indices.length / 3, 0), meshes: [...source.collisionMeshes].sort((a, b) => a.name.localeCompare(b.name)).map((mesh) => ({ name: mesh.name, vertices: mesh.positions.length, triangles: mesh.indices.length / 3, bounds: { min: [0, 1, 2].map((axis) => Math.min(...mesh.positions.map((point) => point[axis]))), max: [0, 1, 2].map((axis) => Math.max(...mesh.positions.map((point) => point[axis]))) } })) }, spawns: spawns.map((spawn) => ({ ...spawn, inBounds: true })), markers: markers.map((marker) => ({ ...marker, inBounds: true })), validation: { errors: [], warnings: [] } }
    return { manifest, files: new Map([['manifest.json', prettyJson(manifest)], ['scene.glb', scene], ['collision.bin', collision], ['debug-report.json', prettyJson(debug)]]) }
}
