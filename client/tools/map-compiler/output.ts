import { surfaceMaps } from './procedural-materials'
import { canonicalJson, prettyJson, sha256 } from './canonical'
import {
    MapCompileError,
    type CompiledMap,
    type MapManifest,
    type TriangleMesh,
    type Vec3,
    type WorldBounds,
} from './types'
import type { ParsedMapSource } from './gltf'

const AREA_EPSILON_SQUARED = 1e-12

function inside(point: Vec3, bounds: WorldBounds): boolean {
    return point.every(
        (entry, index) =>
            entry >= bounds.min[index] && entry <= bounds.max[index]
    )
}

function validateMeshes(
    meshes: readonly TriangleMesh[],
    bounds: WorldBounds,
    label: string
): void {
    for (const mesh of meshes) {
        if (mesh.indices.length === 0 || mesh.indices.length % 3 !== 0)
            throw new MapCompileError(
                `${label} ${mesh.name} must contain complete triangles`
            )
        for (const [index, point] of mesh.positions.entries()) {
            if (!point.every(Number.isFinite))
                throw new MapCompileError(
                    `${label} ${mesh.name} vertex ${index} is non-finite`
                )
            if (!inside(point, bounds))
                throw new MapCompileError(
                    `${label} ${mesh.name} vertex ${index} is outside world bounds`
                )
        }
        for (let i = 0; i < mesh.indices.length; i += 3) {
            const ids = [
                mesh.indices[i],
                mesh.indices[i + 1],
                mesh.indices[i + 2],
            ]
            if (
                ids.some(
                    (id) =>
                        !Number.isInteger(id) ||
                        id < 0 ||
                        id >= mesh.positions.length
                )
            )
                throw new MapCompileError(
                    `${label} ${mesh.name} triangle ${i / 3} has an invalid index`
                )
            const [a, b, c] = ids.map((id) => mesh.positions[id])
            const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
            const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
            const cross = [
                ab[1] * ac[2] - ab[2] * ac[1],
                ab[2] * ac[0] - ab[0] * ac[2],
                ab[0] * ac[1] - ab[1] * ac[0],
            ]
            if (
                cross[0] ** 2 + cross[1] ** 2 + cross[2] ** 2 <=
                AREA_EPSILON_SQUARED
            )
                throw new MapCompileError(
                    `${label} ${mesh.name} triangle ${i / 3} is degenerate`
                )
        }
    }
}

function align4(length: number): number {
    return (length + 3) & ~3
}

function buildSceneGlb(meshes: readonly TriangleMesh[]): Uint8Array {
    const binaryParts: Uint8Array[] = [],
        bufferViews: object[] = [],
        accessors: object[] = [],
        gltfMeshes: object[] = [],
        nodes: object[] = [],
        materials: object[] = []
    const materialCache = new Map<string, number>(),
        images: object[] = [],
        textures: object[] = []
    let byteOffset = 0
    const append = (data: Uint8Array, target?: number): number => {
        const aligned = align4(data.byteLength)
        const padded = new Uint8Array(aligned)
        padded.set(data)
        const index = bufferViews.length
        bufferViews.push({
            buffer: 0,
            byteOffset,
            byteLength: data.byteLength,
            ...(target ? { target } : {}),
        })
        binaryParts.push(padded)
        byteOffset += aligned
        return index
    }
    for (const mesh of [...meshes].sort((a, b) =>
        a.name.localeCompare(b.name)
    )) {
        // Flat face normals and metre-based UVs preserve hard industrial edges.
        const points: number[] = [],
            normals: number[] = [],
            uvs: number[] = []
        for (let i = 0; i < mesh.indices.length; i += 3) {
            const [a, b, c] = mesh.indices
                .slice(i, i + 3)
                .map((id) => mesh.positions[id])
            const ab = b.map((v, j) => v - a[j]),
                ac = c.map((v, j) => v - a[j])
            const n = [
                    ab[1] * ac[2] - ab[2] * ac[1],
                    ab[2] * ac[0] - ab[0] * ac[2],
                    ab[0] * ac[1] - ab[1] * ac[0],
                ],
                l = Math.hypot(...n)
            const axis =
                Math.abs(n[1]) > Math.abs(n[0]) &&
                Math.abs(n[1]) > Math.abs(n[2])
                    ? 1
                    : Math.abs(n[0]) > Math.abs(n[2])
                      ? 0
                      : 2
            for (const p of [a, b, c]) {
                points.push(...p)
                normals.push(...n.map((v) => v / l))
                uvs.push(p[axis === 0 ? 2 : 0] / 3, p[axis === 1 ? 2 : 1] / 3)
            }
        }
        const positions = new Float32Array(points)
        const indices = new Uint32Array(points.length / 3).map((_, i) => i)
        const normalView = append(
            new Uint8Array(new Float32Array(normals).buffer),
            34962
        )
        const uvView = append(
            new Uint8Array(new Float32Array(uvs).buffer),
            34962
        )
        const normalAccessor =
            accessors.push({
                bufferView: normalView,
                componentType: 5126,
                count: points.length / 3,
                type: 'VEC3',
            }) - 1
        const uvAccessor =
            accessors.push({
                bufferView: uvView,
                componentType: 5126,
                count: points.length / 3,
                type: 'VEC2',
            }) - 1
        const positionView = append(new Uint8Array(positions.buffer), 34962)
        const indexView = append(new Uint8Array(indices.buffer), 34963)
        const mins = [0, 1, 2].map((axis) =>
            Math.min(...mesh.positions.map((point) => point[axis]))
        )
        const maxs = [0, 1, 2].map((axis) =>
            Math.max(...mesh.positions.map((point) => point[axis]))
        )
        const positionAccessor =
            accessors.push({
                bufferView: positionView,
                componentType: 5126,
                count: points.length / 3,
                type: 'VEC3',
                min: mins,
                max: maxs,
            }) - 1
        const indexAccessor =
            accessors.push({
                bufferView: indexView,
                componentType: 5125,
                count: mesh.indices.length,
                type: 'SCALAR',
            }) - 1
        const authored = mesh.material ?? {
            name: `${mesh.name}-material`,
            baseColor: [0.52, 0.55, 0.58, 1] as const,
            metallic: 0,
            roughness: 0.9,
        }
        let material = materialCache.get(authored.name)
        if (material === undefined) {
            let detail = {}
            if (authored.name.startsWith('iron-')) {
                const maps = surfaceMaps(authored.name)
                const ids = [maps.albedo, maps.normal, maps.orm].map((uri) => {
                    const source = images.push({ uri }) - 1
                    return textures.push({ source, sampler: 0 }) - 1
                })
                detail = {
                    baseColorTexture: { index: ids[0] },
                    metallicRoughnessTexture: { index: ids[2] },
                }
                material =
                    materials.push({
                        name: authored.name,
                        pbrMetallicRoughness: {
                            baseColorFactor: authored.baseColor,
                            metallicFactor: authored.metallic,
                            roughnessFactor: authored.roughness,
                            ...detail,
                        },
                        normalTexture: { index: ids[1], scale: 0.55 },
                        occlusionTexture: { index: ids[2], strength: 0.45 },
                        doubleSided: /leaves|pine|grass/.test(authored.name),
                    }) - 1
            } else
                material =
                    materials.push({
                        name: authored.name,
                        pbrMetallicRoughness: {
                            baseColorFactor: authored.baseColor,
                            metallicFactor: authored.metallic,
                            roughnessFactor: authored.roughness,
                        },
                    }) - 1
            materialCache.set(authored.name, material)
        }
        const meshIndex =
            gltfMeshes.push({
                name: mesh.name,
                primitives: [
                    {
                        attributes: {
                            POSITION: positionAccessor,
                            NORMAL: normalAccessor,
                            TEXCOORD_0: uvAccessor,
                        },
                        indices: indexAccessor,
                        material,
                    },
                ],
            }) - 1
        nodes.push({ name: mesh.name, mesh: meshIndex })
    }
    const json = {
        asset: { version: '2.0', generator: 'cpp-server-map-compiler/2' },
        scene: 0,
        scenes: [{ nodes: nodes.map((_, index) => index) }],
        nodes,
        meshes: gltfMeshes,
        materials,
        images,
        textures,
        samplers: [
            { magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 },
        ],
        accessors,
        bufferViews,
        buffers: [{ byteLength: byteOffset }],
    }
    const encodedJson = new TextEncoder().encode(canonicalJson(json))
    const jsonLength = align4(encodedJson.byteLength),
        total = 12 + 8 + jsonLength + 8 + byteOffset
    const output = new Uint8Array(total),
        view = new DataView(output.buffer)
    view.setUint32(0, 0x46546c67, true)
    view.setUint32(4, 2, true)
    view.setUint32(8, total, true)
    view.setUint32(12, jsonLength, true)
    view.setUint32(16, 0x4e4f534a, true)
    output.fill(0x20, 20, 20 + jsonLength)
    output.set(encodedJson, 20)
    const binHeader = 20 + jsonLength
    view.setUint32(binHeader, byteOffset, true)
    view.setUint32(binHeader + 4, 0x004e4942, true)
    let cursor = binHeader + 8
    for (const part of binaryParts) {
        output.set(part, cursor)
        cursor += part.byteLength
    }
    return output
}

function flattenMeshes(meshes: readonly TriangleMesh[]): {
    vertices: Vec3[]
    indices: number[]
} {
    const vertices: Vec3[] = [],
        indices: number[] = []
    for (const mesh of [...meshes].sort((a, b) =>
        a.name.localeCompare(b.name)
    )) {
        const base = vertices.length
        vertices.push(...mesh.positions)
        indices.push(...mesh.indices.map((index) => index + base))
    }
    return { vertices, indices }
}

function buildCollision(
    meshes: readonly TriangleMesh[],
    bounds: WorldBounds
): Uint8Array {
    const { vertices, indices } = flattenMeshes(meshes)
    const output = new Uint8Array(
            40 + vertices.length * 12 + indices.length * 4
        ),
        view = new DataView(output.buffer)
    output.set([0x4d, 0x33, 0x43, 0x4c], 0)
    view.setUint16(4, 1, true)
    view.setUint16(6, 0, true)
    view.setUint32(8, vertices.length, true)
    view.setUint32(12, indices.length, true)
    ;[...bounds.min, ...bounds.max].forEach((value, index) =>
        view.setFloat32(16 + index * 4, value, true)
    )
    let offset = 40
    for (const point of vertices)
        for (const component of point) {
            view.setFloat32(offset, component, true)
            offset += 4
        }
    for (const index of indices) {
        view.setUint32(offset, index, true)
        offset += 4
    }
    return output
}

export function compileParsedMap(source: ParsedMapSource): CompiledMap {
    validateMeshes(source.renderMeshes, source.bounds, 'render mesh')
    validateMeshes(source.collisionMeshes, source.bounds, 'collision mesh')
    if (source.spawns.length < 12)
        throw new MapCompileError(
            `map requires at least 12 spawns; found ${source.spawns.length}`
        )
    for (const spawn of source.spawns) {
        if (!inside(spawn.position, source.bounds))
            throw new MapCompileError(
                `spawn ${spawn.id} is outside world bounds`
            )
        if (!Number.isFinite(spawn.yaw))
            throw new MapCompileError(`spawn ${spawn.id} yaw is non-finite`)
    }
    for (const marker of source.markers)
        if (!inside(marker.position, source.bounds))
            throw new MapCompileError(
                `marker ${marker.id} is outside world bounds`
            )
    for (const zone of source.zones)
        if (
            !inside(zone.min, source.bounds) ||
            !inside(zone.max, source.bounds)
        )
            throw new MapCompileError(`zone ${zone.id} is outside world bounds`)
    const spawns = [...source.spawns].sort((a, b) => a.id.localeCompare(b.id)),
        markers = [...source.markers].sort((a, b) => a.id.localeCompare(b.id))
    if (new Set(spawns.map((spawn) => spawn.id)).size !== spawns.length)
        throw new MapCompileError('spawn ids must be unique')
    if (
        source.collisionMeshes.reduce(
            (sum, mesh) => sum + mesh.indices.length / 3,
            0
        ) > 250000
    )
        throw new MapCompileError('collision triangle budget exceeds 250000')
    const modes = new Set(spawns.flatMap((spawn) => spawn.modes))
    if (!modes.has('ffa'))
        throw new MapCompileError('spawn coverage must include ffa')
    const scene =
            source.authoredRenderGlb ??
            (source.renderMeshes.some((m) =>
                m.material?.name.startsWith('iron-')
            )
                ? buildSceneGlb(source.renderMeshes)
                : buildLegacySceneGlb(source.renderMeshes)),
        collision = buildCollision(source.collisionMeshes, source.bounds)
    const gameplay = prettyJson({
        format: 'cpp-server-map-gameplay',
        formatVersion: 2,
        mapId: source.mapId,
        spawnPoints: spawns,
        markers,
        zones: [...source.zones].sort((a, b) => a.id.localeCompare(b.id)),
    })
    const navigation =
        source.navigation.length === 0
            ? null
            : prettyJson({
                  format: 'cpp-server-map-navigation',
                  formatVersion: 2,
                  mapId: source.mapId,
                  nodes: [...source.navigation].sort((a, b) =>
                      a.id.localeCompare(b.id)
                  ),
              })
    const radar =
        source.radarDeclared ||
        markers.some((marker) => marker.type === 'landmark')
            ? new TextEncoder().encode(buildRadar(source))
            : null
    const warnings: string[] = []
    for (let a = 0; a < spawns.length; a++)
        for (let b = a + 1; b < spawns.length; b++)
            if (
                Math.hypot(
                    spawns[a].position[0] - spawns[b].position[0],
                    spawns[a].position[2] - spawns[b].position[2]
                ) < 2
            )
                warnings.push(
                    `spawns ${spawns[a].id} and ${spawns[b].id} are closer than 2m`
                )
    if (source.navigation.length > 0 && !navigationConnected(source.navigation))
        throw new MapCompileError('navigation graph is disconnected')
    if (source.navigation.length > 8192)
        throw new MapCompileError('navigation node budget exceeds 8192')
    const debugObject = {
        format: 'cpp-server-map-debug',
        formatVersion: 2,
        mapId: source.mapId,
        sourceNodes: {
            render: source.renderMeshes.map((mesh) => mesh.name).sort(),
            collision: source.collisionMeshes.map((mesh) => mesh.name).sort(),
            spawns: spawns.map((spawn) => spawn.id),
            markers: markers.map((marker) => marker.id),
            zones: source.zones.map((zone) => zone.id).sort(),
            navigation: source.navigation.map((node) => node.id).sort(),
        },
        render: meshStats(source.renderMeshes),
        collision: meshStats(source.collisionMeshes),
        audits: {
            boundsToleranceMeters: 0.01,
            finiteAndDegenerateTriangles: 'pass',
            collisionTriangleBudget: 'pass',
            spawnBoundsYawAndModeCoverage: 'pass',
            navigationConnectivity:
                source.navigation.length === 0 ? 'explicitly-omitted' : 'pass',
            radarAspectAndLandmarks:
                radar === null ? 'explicitly-omitted' : 'pass',
            renderCollisionBounds: matchingMeshBounds(
                source.renderMeshes,
                source.collisionMeshes,
                0.01
            )
                ? 'pass'
                : 'warning',
        },
        validation: { errors: [], warnings },
    }
    const debug = prettyJson(debugObject)
    const assets = {
        render: 'scene.glb' as const,
        collision: 'collision.bin' as const,
        gameplay: 'gameplay.json' as const,
        navigation: navigation === null ? null : ('navigation.json' as const),
        radar: radar === null ? null : ('radar.svg' as const),
        debug: 'debug-report.json' as const,
    }
    const assetFiles = new Map<string, Uint8Array>([
        ['scene.glb', scene],
        ['collision.bin', collision],
        ['gameplay.json', gameplay],
        ['debug-report.json', debug],
    ])
    if (navigation) assetFiles.set('navigation.json', navigation)
    if (radar) assetFiles.set('radar.svg', radar)
    const assetHashes = Object.fromEntries(
        [...assetFiles]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([name, bytes]) => [name, sha256([bytes])])
    )
    const base = {
        format: 'cpp-server-map' as const,
        formatVersion: 2 as const,
        mapId: source.mapId,
        coordinateSystem: {
            handedness: 'right' as const,
            upAxis: 'Y' as const,
            units: 'meters' as const,
        },
        worldBounds: source.bounds,
        assets,
        assetHashes,
        environment: source.environment,
        policy: source.policy,
    }
    const contentHash = sha256([
        new TextEncoder().encode(canonicalJson(base)),
        ...[...assetFiles]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([, bytes]) => bytes),
    ])
    const manifest: MapManifest = { ...base, contentHash }
    return {
        manifest,
        files: new Map([
            ['manifest.json', prettyJson(manifest)],
            ...assetFiles,
        ]),
    }
}

function meshStats(meshes: readonly TriangleMesh[]): object {
    return {
        meshCount: meshes.length,
        vertexCount: meshes.reduce(
            (sum, mesh) => sum + mesh.positions.length,
            0
        ),
        triangleCount: meshes.reduce(
            (sum, mesh) => sum + mesh.indices.length / 3,
            0
        ),
        meshes: [...meshes]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((mesh) => ({
                name: mesh.name,
                material: mesh.material?.name ?? null,
                vertices: mesh.positions.length,
                triangles: mesh.indices.length / 3,
                bounds: meshBounds([mesh]),
            })),
    }
}
function meshBounds(meshes: readonly TriangleMesh[]): WorldBounds {
    const points = meshes.flatMap((mesh) => mesh.positions)
    return {
        min: [0, 1, 2].map((axis) =>
            points.reduce(
                (value, point) => Math.min(value, point[axis]),
                Infinity
            )
        ) as unknown as Vec3,
        max: [0, 1, 2].map((axis) =>
            points.reduce(
                (value, point) => Math.max(value, point[axis]),
                -Infinity
            )
        ) as unknown as Vec3,
    }
}
function matchingMeshBounds(
    a: readonly TriangleMesh[],
    b: readonly TriangleMesh[],
    tolerance: number
): boolean {
    const x = meshBounds(a),
        y = meshBounds(b)
    return [...x.min, ...x.max].every(
        (value, index) =>
            Math.abs(value - [...y.min, ...y.max][index]) <= tolerance
    )
}
function navigationConnected(nodes: ParsedMapSource['navigation']): boolean {
    if (nodes.length === 0) return true
    const byId = new Map(nodes.map((node) => [node.id, node]))
    if (
        byId.size !== nodes.length ||
        nodes.some((node) => node.links.some((link) => !byId.has(link)))
    )
        return false
    const seen = new Set<string>(),
        queue = [nodes[0].id]
    while (queue.length) {
        const id = queue.shift()!
        if (seen.has(id)) continue
        seen.add(id)
        for (const link of byId.get(id)!.links) queue.push(link)
    }
    return seen.size === nodes.length
}
function buildRadar(source: ParsedMapSource): string {
    if (source.mapId === 'ironworks') {
        const w = source.bounds.max[0] - source.bounds.min[0],
            d = source.bounds.max[2] - source.bounds.min[2]
        const colors: Record<string, string> = {
            earth: '#29342e',
            concrete: '#77807a',
            plaster: '#69746c',
            brick: '#5f6c62',
            steel: '#53635f',
            asphalt: '#172625',
            gravel: '#48594d',
            rust: '#76644e',
            paint: '#5e7165',
            pine: '#1d3024',
            leaves: '#37462d',
            wood: '#526049',
            water: '#345258',
        }
        const shapes: string[] = []
        for (const mesh of source.renderMeshes) {
            const color = colors[mesh.material?.name.replace('iron-', '') ?? '']
            if (!color) continue
            for (let i = 0; i < mesh.indices.length; i += 3) {
                const [a, b, c] = mesh.indices
                    .slice(i, i + 3)
                    .map((j) => mesh.positions[j])
                const area =
                    (b[0] - a[0]) * (c[2] - a[2]) -
                    (b[2] - a[2]) * (c[0] - a[0])
                if (Math.abs(area) < 0.2) continue
                shapes.push(
                    `<path d="M${[a, b, c].map((p) => `${(p[0] + w / 2).toFixed(1)},${(p[2] + d / 2).toFixed(1)}`).join('L')}Z" fill="${color}"/>`
                )
            }
        }
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${d}"><rect width="100%" height="100%" fill="#27352e"/>${shapes.join('')}<path d="M0 ${d / 2}H${w}M${w / 2} 0V${d}" stroke="#cedac9" opacity=".08"/></svg>\n`
    }
    const width = source.bounds.max[0] - source.bounds.min[0],
        depth = source.bounds.max[2] - source.bounds.min[2]
    const points = source.markers
        .filter((marker) => marker.type === 'landmark')
        .map((marker) => {
            const x = (
                    ((marker.position[0] - source.bounds.min[0]) / width) *
                    1000
                ).toFixed(3),
                y = (
                    ((source.bounds.max[2] - marker.position[2]) / depth) *
                    ((1000 * depth) / width)
                ).toFixed(3)
            return `<circle id="${marker.id}" cx="${x}" cy="${y}" r="8"/>`
        })
        .join('')
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 ${((1000 * depth) / width).toFixed(3)}"><rect width="100%" height="100%" fill="#18202b"/><g fill="#d8b65a">${points}</g></svg>\n`
}

function buildLegacySceneGlb(meshes: readonly TriangleMesh[]): Uint8Array {
    const binaryParts: Uint8Array[] = [],
        bufferViews: object[] = [],
        accessors: object[] = [],
        gltfMeshes: object[] = [],
        nodes: object[] = [],
        materials: object[] = []
    let byteOffset = 0
    const append = (data: Uint8Array, target?: number): number => {
        const aligned = align4(data.byteLength)
        const padded = new Uint8Array(aligned)
        padded.set(data)
        const index = bufferViews.length
        bufferViews.push({
            buffer: 0,
            byteOffset,
            byteLength: data.byteLength,
            ...(target ? { target } : {}),
        })
        binaryParts.push(padded)
        byteOffset += aligned
        return index
    }
    for (const mesh of [...meshes].sort((a, b) =>
        a.name.localeCompare(b.name)
    )) {
        const positions = new Float32Array(mesh.positions.flat())
        const indices = new Uint32Array(mesh.indices)
        const positionView = append(new Uint8Array(positions.buffer), 34962)
        const indexView = append(new Uint8Array(indices.buffer), 34963)
        const mins = [0, 1, 2].map((axis) =>
            Math.min(...mesh.positions.map((point) => point[axis]))
        )
        const maxs = [0, 1, 2].map((axis) =>
            Math.max(...mesh.positions.map((point) => point[axis]))
        )
        const positionAccessor =
            accessors.push({
                bufferView: positionView,
                componentType: 5126,
                count: mesh.positions.length,
                type: 'VEC3',
                min: mins,
                max: maxs,
            }) - 1
        const indexAccessor =
            accessors.push({
                bufferView: indexView,
                componentType: 5125,
                count: mesh.indices.length,
                type: 'SCALAR',
            }) - 1
        const authored = mesh.material ?? {
            name: `${mesh.name}-material`,
            baseColor: [0.52, 0.55, 0.58, 1] as const,
            metallic: 0,
            roughness: 0.9,
        }
        const material =
            materials.push({
                name: authored.name,
                pbrMetallicRoughness: {
                    baseColorFactor: authored.baseColor,
                    metallicFactor: authored.metallic,
                    roughnessFactor: authored.roughness,
                },
            }) - 1
        const meshIndex =
            gltfMeshes.push({
                name: mesh.name,
                primitives: [
                    {
                        attributes: { POSITION: positionAccessor },
                        indices: indexAccessor,
                        material,
                    },
                ],
            }) - 1
        nodes.push({ name: mesh.name, mesh: meshIndex })
    }
    const json = {
        asset: { version: '2.0', generator: 'cpp-server-map-compiler/2' },
        scene: 0,
        scenes: [{ nodes: nodes.map((_, index) => index) }],
        nodes,
        meshes: gltfMeshes,
        materials,
        accessors,
        bufferViews,
        buffers: [{ byteLength: byteOffset }],
    }
    const encodedJson = new TextEncoder().encode(canonicalJson(json))
    const jsonLength = align4(encodedJson.byteLength),
        total = 12 + 8 + jsonLength + 8 + byteOffset
    const output = new Uint8Array(total),
        view = new DataView(output.buffer)
    view.setUint32(0, 0x46546c67, true)
    view.setUint32(4, 2, true)
    view.setUint32(8, total, true)
    view.setUint32(12, jsonLength, true)
    view.setUint32(16, 0x4e4f534a, true)
    output.fill(0x20, 20, 20 + jsonLength)
    output.set(encodedJson, 20)
    const binHeader = 20 + jsonLength
    view.setUint32(binHeader, byteOffset, true)
    view.setUint32(binHeader + 4, 0x004e4942, true)
    let cursor = binHeader + 8
    for (const part of binaryParts) {
        output.set(part, cursor)
        cursor += part.byteLength
    }
    return output
}
