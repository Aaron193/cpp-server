import { expandInlineGeometry, readVec3, type InlineGeometry } from './geometry'
import { MapCompileError, type MapMarker, type MapSpawn, type TriangleMesh, type Vec3, type WorldBounds } from './types'

type Json = Record<string, any>
type Role = 'render' | 'collision' | 'spawn' | 'marker'

export interface ParsedMapSource {
    readonly mapId: string
    readonly bounds: WorldBounds
    readonly renderMeshes: readonly TriangleMesh[]
    readonly collisionMeshes: readonly TriangleMesh[]
    readonly spawns: readonly MapSpawn[]
    readonly markers: readonly MapMarker[]
}

const COLLECTION_ROLES: Readonly<Record<string, Role>> = {
    Render: 'render', Collision: 'collision', Spawns: 'spawn', Markers: 'marker',
}
const NODE_EXTRA_KEYS = new Set(['collection', 'mapRole', 'yaw', 'markerType', 'geometry'])
const ROOT_MAP_KEYS = new Set(['id', 'bounds'])

function object(value: unknown, context: string): Json {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new MapCompileError(`${context} must be an object`)
    }
    return value as Json
}

function finite(value: unknown, context: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new MapCompileError(`${context} must be finite`)
    }
    return value
}

function checkedKeys(value: Json, allowed: ReadonlySet<string>, context: string): void {
    for (const key of Object.keys(value)) {
        if (!allowed.has(key)) throw new MapCompileError(`${context} has unsupported property "${key}"`)
    }
}

function decodeDataUri(uri: unknown, context: string): Uint8Array {
    if (typeof uri !== 'string' || !uri.startsWith('data:application/octet-stream;base64,')) {
        throw new MapCompileError(`${context} must use an embedded application/octet-stream base64 URI`)
    }
    return Uint8Array.from(Buffer.from(uri.slice(uri.indexOf(',') + 1), 'base64'))
}

function componentInfo(type: unknown): { size: number; read: (view: DataView, offset: number) => number } {
    switch (type) {
        case 5121: return { size: 1, read: (view, offset) => view.getUint8(offset) }
        case 5123: return { size: 2, read: (view, offset) => view.getUint16(offset, true) }
        case 5125: return { size: 4, read: (view, offset) => view.getUint32(offset, true) }
        case 5126: return { size: 4, read: (view, offset) => view.getFloat32(offset, true) }
        default: throw new MapCompileError(`Unsupported glTF componentType ${String(type)}`)
    }
}

function readAccessor(root: Json, buffers: readonly Uint8Array[], accessorIndex: unknown, expectedType: 'VEC3' | 'SCALAR', context: string): number[] {
    if (!Number.isInteger(accessorIndex)) throw new MapCompileError(`${context} accessor is required`)
    const accessor = object(root.accessors?.[accessorIndex as number], `${context} accessor`)
    if (accessor.type !== expectedType) throw new MapCompileError(`${context} accessor must be ${expectedType}`)
    if (accessor.sparse !== undefined) throw new MapCompileError(`${context} sparse accessors are unsupported`)
    const view = object(root.bufferViews?.[accessor.bufferView], `${context} bufferView`)
    const buffer = buffers[view.buffer]
    if (!buffer) throw new MapCompileError(`${context} references an invalid buffer`)
    const components = expectedType === 'VEC3' ? 3 : 1
    const info = componentInfo(accessor.componentType)
    if (expectedType === 'VEC3' && accessor.componentType !== 5126) {
        throw new MapCompileError(`${context} positions must use FLOAT components`)
    }
    if (expectedType === 'SCALAR' && ![5121, 5123, 5125].includes(accessor.componentType)) {
        throw new MapCompileError(`${context} indices must be unsigned integers`)
    }
    const count = finite(accessor.count, `${context}.count`)
    if (!Number.isInteger(count) || count < 0) throw new MapCompileError(`${context}.count is invalid`)
    const stride = view.byteStride ?? components * info.size
    if (!Number.isInteger(stride) || stride < components * info.size) throw new MapCompileError(`${context} has invalid byteStride`)
    const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
    const required = count === 0 ? start : start + (count - 1) * stride + components * info.size
    if (start < 0 || required > buffer.byteLength || required > (view.byteOffset ?? 0) + view.byteLength) {
        throw new MapCompileError(`${context} exceeds its bufferView`)
    }
    const data = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    const result: number[] = []
    for (let i = 0; i < count; i++) {
        for (let c = 0; c < components; c++) {
            result.push(finite(info.read(data, start + i * stride + c * info.size), context))
        }
    }
    return result
}

function transformPoint(point: Vec3, translation: Vec3, rotation: readonly [number, number, number, number]): Vec3 {
    const [x, y, z] = point
    const [qx, qy, qz, qw] = rotation
    const ix = qw * x + qy * z - qz * y
    const iy = qw * y + qz * x - qx * z
    const iz = qw * z + qx * y - qy * x
    const iw = -qx * x - qy * y - qz * z
    return [
        ix * qw + iw * -qx + iy * -qz - iz * -qy + translation[0],
        iy * qw + iw * -qy + iz * -qx - ix * -qz + translation[1],
        iz * qw + iw * -qz + ix * -qy - iy * -qx + translation[2],
    ]
}

function combineTransform(parentT: Vec3, parentR: readonly [number, number, number, number], localT: Vec3, localR: readonly [number, number, number, number]): { t: Vec3; r: [number, number, number, number] } {
    const t = transformPoint(localT, parentT, parentR)
    const [ax, ay, az, aw] = parentR
    const [bx, by, bz, bw] = localR
    return { t, r: [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz] }
}

function parseRotation(value: unknown, context: string): [number, number, number, number] {
    if (value === undefined) return [0, 0, 0, 1]
    if (!Array.isArray(value) || value.length !== 4) throw new MapCompileError(`${context} must contain four finite numbers`)
    const result = value.map((entry, index) => finite(entry, `${context}[${index}]`)) as [number, number, number, number]
    const length = Math.hypot(...result)
    if (Math.abs(length - 1) > 1e-4) throw new MapCompileError(`${context} must be a normalized quaternion`)
    return result
}

function roleFor(node: Json, inherited?: Role): Role | undefined {
    const extras = node.extras === undefined ? {} : object(node.extras, `node ${node.name ?? '<unnamed>'}.extras`)
    checkedKeys(extras, NODE_EXTRA_KEYS, `node ${node.name ?? '<unnamed>'}.extras`)
    const collection = extras.collection ?? node.name
    const collectionRole = typeof collection === 'string' ? COLLECTION_ROLES[collection] : undefined
    const explicit = extras.mapRole
    if (explicit !== undefined && !['render', 'collision', 'spawn', 'marker'].includes(explicit)) {
        throw new MapCompileError(`node ${node.name ?? '<unnamed>'} has unsupported mapRole "${String(explicit)}"`)
    }
    if (collectionRole && explicit && collectionRole !== explicit) throw new MapCompileError(`node ${node.name} collection and mapRole disagree`)
    return explicit ?? collectionRole ?? inherited
}

export function parseMapGltf(input: unknown): ParsedMapSource {
    const root = object(input, 'glTF')
    if (root.asset?.version !== '2.0') throw new MapCompileError('glTF asset.version must be "2.0"')
    const rootExtras = object(root.extras, 'glTF extras')
    checkedKeys(rootExtras, new Set(['map']), 'glTF extras')
    const map = object(rootExtras.map, 'glTF extras.map')
    checkedKeys(map, ROOT_MAP_KEYS, 'glTF extras.map')
    if (typeof map.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(map.id)) throw new MapCompileError('map id must be lowercase kebab-case')
    const boundsObject = object(map.bounds, 'glTF extras.map.bounds')
    checkedKeys(boundsObject, new Set(['min', 'max']), 'glTF extras.map.bounds')
    const bounds = { min: readVec3(boundsObject.min, 'world bounds min'), max: readVec3(boundsObject.max, 'world bounds max') }
    if (bounds.min.some((entry, i) => entry >= bounds.max[i])) throw new MapCompileError('world bounds min must be less than max')
    const buffers = (root.buffers ?? []).map((buffer: unknown, index: number) => decodeDataUri(object(buffer, `buffer ${index}`).uri, `buffer ${index}.uri`))
    const nodes = Array.isArray(root.nodes) ? root.nodes : []
    const scene = root.scenes?.[root.scene ?? 0]
    if (!scene || !Array.isArray(scene.nodes)) throw new MapCompileError('glTF default scene must list root nodes')
    const renderMeshes: TriangleMesh[] = [], collisionMeshes: TriangleMesh[] = []
    const spawns: MapSpawn[] = [], markers: MapMarker[] = []
    const names = new Set<string>(), visited = new Set<number>()

    const visit = (index: number, inherited: Role | undefined, parentT: Vec3, parentR: [number, number, number, number]): void => {
        if (!Number.isInteger(index) || !nodes[index]) throw new MapCompileError(`scene references invalid node ${index}`)
        if (visited.has(index)) throw new MapCompileError(`node ${index} appears more than once or forms a cycle`)
        visited.add(index)
        const node = object(nodes[index], `node ${index}`)
        if (typeof node.name !== 'string' || node.name.length === 0) throw new MapCompileError(`node ${index} requires a name`)
        if (names.has(node.name)) throw new MapCompileError(`duplicate node name "${node.name}"`)
        names.add(node.name)
        if (node.matrix !== undefined) throw new MapCompileError(`node ${node.name} matrix transforms are unsupported; export TRS`)
        if (node.scale !== undefined) {
            const scale = readVec3(node.scale, `node ${node.name}.scale`)
            if (scale.some((entry) => Math.abs(entry - 1) > 1e-6)) throw new MapCompileError(`node ${node.name} has unapplied scale; apply transforms in Blender`)
        }
        const localT = node.translation === undefined ? [0, 0, 0] as Vec3 : readVec3(node.translation, `node ${node.name}.translation`)
        const localR = parseRotation(node.rotation, `node ${node.name}.rotation`)
        const world = combineTransform(parentT, parentR, localT, localR)
        const role = roleFor(node, inherited)
        const extras = (node.extras ?? {}) as Json
        const collectionName = extras.collection ?? node.name
        const isCollectionRoot =
            COLLECTION_ROLES[collectionName] !== undefined &&
            node.mesh === undefined &&
            extras.geometry === undefined &&
            Array.isArray(node.children)

        if (isCollectionRoot) {
            // Blender collection roots carry the role for their child objects.
        } else if (role === 'spawn') {
            if (node.mesh !== undefined || extras.geometry !== undefined) throw new MapCompileError(`spawn ${node.name} cannot contain geometry`)
            const yaw = extras.yaw === undefined ? 0 : finite(extras.yaw, `spawn ${node.name}.yaw`)
            spawns.push({ id: node.name, position: world.t, yaw })
        } else if (role === 'marker') {
            if (node.mesh !== undefined || extras.geometry !== undefined) throw new MapCompileError(`marker ${node.name} cannot contain geometry`)
            if (!['landmark', 'pickup', 'objective'].includes(extras.markerType)) throw new MapCompileError(`marker ${node.name} requires a supported markerType`)
            markers.push({ id: node.name, type: extras.markerType, position: world.t })
        } else if (role === 'render' || role === 'collision') {
            let raw: { positions: Vec3[]; indices: number[] }
            if (extras.geometry !== undefined) {
                raw = expandInlineGeometry(object(extras.geometry, `node ${node.name}.geometry`) as InlineGeometry, `node ${node.name}.geometry`)
            } else {
                const mesh = object(root.meshes?.[node.mesh], `node ${node.name}.mesh`)
                if (!Array.isArray(mesh.primitives) || mesh.primitives.length !== 1) throw new MapCompileError(`node ${node.name} must use exactly one mesh primitive`)
                const primitive = object(mesh.primitives[0], `node ${node.name}.primitive`)
                if (primitive.mode !== undefined && primitive.mode !== 4) throw new MapCompileError(`node ${node.name} must use TRIANGLES mode`)
                const flat = readAccessor(root, buffers, primitive.attributes?.POSITION, 'VEC3', `${node.name} positions`)
                const positions: Vec3[] = []
                for (let i = 0; i < flat.length; i += 3) positions.push([flat[i], flat[i + 1], flat[i + 2]])
                raw = { positions, indices: readAccessor(root, buffers, primitive.indices, 'SCALAR', `${node.name} indices`) }
            }
            const transformed = { name: node.name, positions: raw.positions.map((point) => transformPoint(point, world.t, world.r)), indices: raw.indices }
            ;(role === 'render' ? renderMeshes : collisionMeshes).push(transformed)
        }
        for (const child of node.children ?? []) visit(child, role, world.t, world.r)
    }
    for (const index of scene.nodes) visit(index, undefined, [0, 0, 0], [0, 0, 0, 1])
    if (renderMeshes.length === 0) throw new MapCompileError('map requires render geometry')
    if (collisionMeshes.length === 0) throw new MapCompileError('map requires collision geometry')
    return { mapId: map.id, bounds, renderMeshes, collisionMeshes, spawns, markers }
}
