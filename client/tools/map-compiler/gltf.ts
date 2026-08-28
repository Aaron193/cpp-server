import { expandInlineGeometry, readVec3, type InlineGeometry } from './geometry'
import { canonicalJson } from './canonical'
import { MapCompileError, type MapMarker, type MapSpawn, type MapZone, type NavigationNode, type TriangleMesh, type Vec3, type WorldBounds } from './types'

type Json = Record<string, any>
type Role = 'render' | 'collision' | 'spawn' | 'marker' | 'zone' | 'navigation' | 'radar'

export interface ParsedMapSource {
    readonly mapId: string
    readonly bounds: WorldBounds
    readonly renderMeshes: readonly TriangleMesh[]
    readonly collisionMeshes: readonly TriangleMesh[]
    readonly spawns: readonly MapSpawn[]
    readonly markers: readonly MapMarker[]
    readonly zones: readonly MapZone[]
    readonly navigation: readonly NavigationNode[]
    readonly radarDeclared: boolean
    readonly environment: { readonly clearColor: readonly [number, number, number]; readonly exposure: number; readonly sunDirection: Vec3; readonly shadowDistance: number }
    readonly policy: { readonly stepSmoothingMax: number; readonly audioDistanceScale: number; readonly radarNorthYaw: number }
    readonly authoredRenderGlb: Uint8Array | null
}

const COLLECTION_ROLES: Readonly<Record<string, Role>> = {
    Render: 'render', Collision: 'collision', Spawns: 'spawn', Markers: 'marker', Zones: 'zone', Navigation: 'navigation', Radar: 'radar',
}
const NODE_EXTRA_KEYS = new Set(['collection', 'mapRole', 'yaw', 'markerType', 'geometry', 'material', 'modes', 'team', 'weight', 'clearanceRadius', 'zoneType', 'size', 'links'])
const ROOT_MAP_KEYS = new Set(['id', 'bounds', 'environment', 'policy'])

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

function readAccessor(root: Json, buffers: readonly Uint8Array[], accessorIndex: unknown, expectedType: 'VEC2' | 'VEC3' | 'VEC4' | 'SCALAR', context: string): number[] {
    if (!Number.isInteger(accessorIndex)) throw new MapCompileError(`${context} accessor is required`)
    const accessor = object(root.accessors?.[accessorIndex as number], `${context} accessor`)
    if (accessor.type !== expectedType) throw new MapCompileError(`${context} accessor must be ${expectedType}`)
    if (accessor.sparse !== undefined) throw new MapCompileError(`${context} sparse accessors are unsupported`)
    const view = object(root.bufferViews?.[accessor.bufferView], `${context} bufferView`)
    const buffer = buffers[view.buffer]
    if (!buffer) throw new MapCompileError(`${context} references an invalid buffer`)
    const components = expectedType === 'VEC2' ? 2 : expectedType === 'VEC3' ? 3 : expectedType === 'VEC4' ? 4 : 1
    const info = componentInfo(accessor.componentType)
    if (expectedType !== 'SCALAR' && accessor.componentType !== 5126) {
        throw new MapCompileError(`${context} vector data must use FLOAT components`)
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
    if (explicit !== undefined && !['render', 'collision', 'spawn', 'marker', 'zone', 'navigation', 'radar'].includes(explicit)) {
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
    if ([...bounds.min, ...bounds.max].some((entry) => Math.abs(entry) > 100000)) throw new MapCompileError('world bounds exceed the 100 km coordinate limit')
    const environmentObject = map.environment === undefined ? {} : object(map.environment, 'glTF extras.map.environment')
    checkedKeys(environmentObject, new Set(['clearColor', 'exposure', 'sunDirection', 'shadowDistance']), 'glTF extras.map.environment')
    const clearColor = environmentObject.clearColor === undefined ? [0.055, 0.075, 0.11] as const : readVec3(environmentObject.clearColor, 'environment.clearColor')
    if (clearColor.some((entry) => entry < 0 || entry > 1)) throw new MapCompileError('environment.clearColor must be in [0,1]')
    const environment = { clearColor, exposure: environmentObject.exposure === undefined ? 1 : finite(environmentObject.exposure, 'environment.exposure'), sunDirection: environmentObject.sunDirection === undefined ? [-0.4, -1, 0.3] as Vec3 : readVec3(environmentObject.sunDirection, 'environment.sunDirection'), shadowDistance: environmentObject.shadowDistance === undefined ? 80 : finite(environmentObject.shadowDistance, 'environment.shadowDistance') }
    if (environment.exposure <= 0 || environment.exposure > 8 || environment.shadowDistance < 0 || environment.shadowDistance > 1000) throw new MapCompileError('environment values are outside supported ranges')
    const policyObject = map.policy === undefined ? {} : object(map.policy, 'glTF extras.map.policy')
    checkedKeys(policyObject, new Set(['stepSmoothingMax', 'audioDistanceScale', 'radarNorthYaw']), 'glTF extras.map.policy')
    const policy = { stepSmoothingMax: policyObject.stepSmoothingMax === undefined ? 0.45 : finite(policyObject.stepSmoothingMax, 'policy.stepSmoothingMax'), audioDistanceScale: policyObject.audioDistanceScale === undefined ? 1 : finite(policyObject.audioDistanceScale, 'policy.audioDistanceScale'), radarNorthYaw: policyObject.radarNorthYaw === undefined ? 0 : finite(policyObject.radarNorthYaw, 'policy.radarNorthYaw') }
    if (policy.stepSmoothingMax < 0 || policy.stepSmoothingMax > 2 || policy.audioDistanceScale <= 0 || policy.audioDistanceScale > 100 || Math.abs(policy.radarNorthYaw) > Math.PI * 2) throw new MapCompileError('map policy is outside supported ranges')
    const buffers = (root.buffers ?? []).map((buffer: unknown, index: number) => decodeDataUri(object(buffer, `buffer ${index}`).uri, `buffer ${index}.uri`))
    const nodes = Array.isArray(root.nodes) ? root.nodes : []
    const scene = root.scenes?.[root.scene ?? 0]
    if (!scene || !Array.isArray(scene.nodes)) throw new MapCompileError('glTF default scene must list root nodes')
    const renderMeshes: TriangleMesh[] = [], collisionMeshes: TriangleMesh[] = []
    const spawns: MapSpawn[] = [], markers: MapMarker[] = [], zones: MapZone[] = [], navigation: NavigationNode[] = []
    let radarDeclared = false
    const names = new Set<string>(), visited = new Set<number>()
    const authoredRenderNodes: { name: string; mesh: number; translation: Vec3; rotation: readonly [number, number, number, number] }[] = []
    let allRenderNodesAuthored = true

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
            const modes = extras.modes === undefined ? ['ffa'] : extras.modes
            if (!Array.isArray(modes) || modes.length === 0 || modes.length > 16 || modes.some((mode: unknown) => typeof mode !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(mode))) throw new MapCompileError(`spawn ${node.name}.modes is invalid`)
            const team = extras.team === undefined || extras.team === null ? null : extras.team
            if (team !== null && (typeof team !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(team))) throw new MapCompileError(`spawn ${node.name}.team is invalid`)
            const weight = extras.weight === undefined ? 1 : finite(extras.weight, `spawn ${node.name}.weight`)
            const clearanceRadius = extras.clearanceRadius === undefined ? 0.45 : finite(extras.clearanceRadius, `spawn ${node.name}.clearanceRadius`)
            if (weight <= 0 || weight > 100 || clearanceRadius < 0.2 || clearanceRadius > 5) throw new MapCompileError(`spawn ${node.name} metadata is outside supported ranges`)
            spawns.push({ id: node.name, position: world.t, yaw, modes: [...modes], team, weight, clearanceRadius })
        } else if (role === 'marker') {
            if (node.mesh !== undefined || extras.geometry !== undefined) throw new MapCompileError(`marker ${node.name} cannot contain geometry`)
            if (!['landmark', 'pickup', 'objective', 'callout'].includes(extras.markerType)) throw new MapCompileError(`marker ${node.name} requires a supported markerType`)
            markers.push({ id: node.name, type: extras.markerType, position: world.t })
        } else if (role === 'zone') {
            if (!['playable', 'kill', 'objective', 'audio', 'reverb', 'projectile-fence'].includes(extras.zoneType)) throw new MapCompileError(`zone ${node.name} requires a supported zoneType`)
            const size = readVec3(extras.size, `zone ${node.name}.size`)
            if (size.some((entry) => entry <= 0)) throw new MapCompileError(`zone ${node.name}.size must be positive`)
            zones.push({ id: node.name, type: extras.zoneType, min: [world.t[0] - size[0] / 2, world.t[1] - size[1] / 2, world.t[2] - size[2] / 2], max: [world.t[0] + size[0] / 2, world.t[1] + size[1] / 2, world.t[2] + size[2] / 2] })
        } else if (role === 'navigation') {
            const links = extras.links ?? []
            if (!Array.isArray(links) || links.length > 32 || links.some((link: unknown) => typeof link !== 'string')) throw new MapCompileError(`navigation node ${node.name}.links is invalid`)
            navigation.push({ id: node.name, position: world.t, links: [...links] })
        } else if (role === 'radar') {
            radarDeclared = true
        } else if (role === 'render' || role === 'collision') {
            let raw: { positions: Vec3[]; indices: number[] }
            if (extras.geometry !== undefined) {
                if (role === 'render') allRenderNodesAuthored = false
                raw = expandInlineGeometry(object(extras.geometry, `node ${node.name}.geometry`) as InlineGeometry, `node ${node.name}.geometry`)
            } else {
                const mesh = object(root.meshes?.[node.mesh], `node ${node.name}.mesh`)
                if (!Array.isArray(mesh.primitives) || mesh.primitives.length !== 1) throw new MapCompileError(`node ${node.name} must use exactly one mesh primitive`)
                const primitive = object(mesh.primitives[0], `node ${node.name}.primitive`)
                if (primitive.mode !== undefined && primitive.mode !== 4) throw new MapCompileError(`node ${node.name} must use TRIANGLES mode`)
                const flat = readAccessor(root, buffers, primitive.attributes?.POSITION, 'VEC3', `${node.name} positions`)
                const positions: Vec3[] = []
                for (let i = 0; i < flat.length; i += 3) positions.push([flat[i], flat[i + 1], flat[i + 2]])
                for (const [attribute, type, components] of [['NORMAL', 'VEC3', 3], ['TEXCOORD_0', 'VEC2', 2], ['TANGENT', 'VEC4', 4]] as const) {
                    if (primitive.attributes?.[attribute] === undefined) continue
                    const values = readAccessor(root, buffers, primitive.attributes[attribute], type, `${node.name} ${attribute}`)
                    if (values.length / components !== positions.length) throw new MapCompileError(`${node.name} ${attribute} count must match POSITION`)
                }
                raw = { positions, indices: readAccessor(root, buffers, primitive.indices, 'SCALAR', `${node.name} indices`) }
                if (role === 'render') authoredRenderNodes.push({ name: node.name, mesh: node.mesh, translation: world.t, rotation: world.r })
            }
            let material: TriangleMesh['material']
            if (role === 'render') {
                const authored = extras.material === undefined ? {} : object(extras.material, `node ${node.name}.material`)
                checkedKeys(authored, new Set(['name', 'baseColor', 'metallic', 'roughness']), `node ${node.name}.material`)
                const base = authored.baseColor === undefined ? [0.52, 0.55, 0.58, 1] : authored.baseColor
                if (!Array.isArray(base) || base.length !== 4 || base.some((value: unknown) => typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)) throw new MapCompileError(`node ${node.name}.material.baseColor is invalid`)
                material = { name: typeof authored.name === 'string' ? authored.name : `${node.name}-material`, baseColor: base as [number, number, number, number], metallic: authored.metallic === undefined ? 0 : finite(authored.metallic, `${node.name}.material.metallic`), roughness: authored.roughness === undefined ? 0.9 : finite(authored.roughness, `${node.name}.material.roughness`) }
                if (material.metallic < 0 || material.metallic > 1 || material.roughness < 0 || material.roughness > 1) throw new MapCompileError(`node ${node.name}.material values must be in [0,1]`)
            }
            const transformed = { name: node.name, positions: raw.positions.map((point) => transformPoint(point, world.t, world.r)), indices: raw.indices, ...(material ? { material } : {}) }
            ;(role === 'render' ? renderMeshes : collisionMeshes).push(transformed)
        }
        for (const child of node.children ?? []) visit(child, role, world.t, world.r)
    }
    for (const index of scene.nodes) visit(index, undefined, [0, 0, 0], [0, 0, 0, 1])
    if (renderMeshes.length === 0) throw new MapCompileError('map requires render geometry')
    if (collisionMeshes.length === 0) throw new MapCompileError('map requires collision geometry')
    const insideBounds = (point: Vec3): boolean => point.every((entry, axis) => entry >= bounds.min[axis] && entry <= bounds.max[axis])
    for (const zone of zones) if (!insideBounds(zone.min) || !insideBounds(zone.max)) throw new MapCompileError(`zone ${zone.id} is outside world bounds`)
    const navIds = new Set(navigation.map((entry) => entry.id))
    for (const entry of navigation) for (const link of entry.links) if (!navIds.has(link)) throw new MapCompileError(`navigation node ${entry.id} links to missing node ${link}`)
    const authoredRenderGlb = allRenderNodesAuthored && authoredRenderNodes.length === renderMeshes.length ? preserveAuthoredRenderGlb(root, buffers, authoredRenderNodes) : null
    return { mapId: map.id, bounds, renderMeshes, collisionMeshes, spawns, markers, zones, navigation, radarDeclared, environment, policy, authoredRenderGlb }
}

function preserveAuthoredRenderGlb(root: Json, buffers: readonly Uint8Array[], nodes: readonly { name: string; mesh: number; translation: Vec3; rotation: readonly [number, number, number, number] }[]): Uint8Array {
    const align4 = (value: number) => (value + 3) & ~3
    const bases: number[] = []; let binaryLength = 0
    for (const buffer of buffers) { bases.push(binaryLength); binaryLength += align4(buffer.byteLength) }
    const document: Json = { asset: { ...root.asset, generator: `${root.asset.generator ?? 'DCC'}; cpp-server-map-compiler/2 preserved` }, scene: 0, scenes: [{ nodes: nodes.map((_, index) => index) }], nodes: nodes.map((node) => ({ name: node.name, mesh: node.mesh, translation: node.translation, rotation: node.rotation })), meshes: root.meshes, accessors: root.accessors, bufferViews: (root.bufferViews ?? []).map((view: Json) => ({ ...view, buffer: 0, byteOffset: bases[view.buffer] + (view.byteOffset ?? 0) })), buffers: [{ byteLength: binaryLength }] }
    for (const key of ['materials', 'textures', 'images', 'samplers', 'extensionsUsed', 'extensionsRequired', 'extensions']) if (root[key] !== undefined) document[key] = root[key]
    const encoded = new TextEncoder().encode(canonicalJson(document)), jsonLength = align4(encoded.byteLength), total = 12 + 8 + jsonLength + 8 + binaryLength
    const output = new Uint8Array(total), view = new DataView(output.buffer)
    view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, total, true); view.setUint32(12, jsonLength, true); view.setUint32(16, 0x4e4f534a, true)
    output.fill(0x20, 20, 20 + jsonLength); output.set(encoded, 20)
    const binHeader = 20 + jsonLength; view.setUint32(binHeader, binaryLength, true); view.setUint32(binHeader + 4, 0x004e4942, true)
    let cursor = binHeader + 8; for (const buffer of buffers) { output.set(buffer, cursor); cursor += align4(buffer.byteLength) }
    return output
}
