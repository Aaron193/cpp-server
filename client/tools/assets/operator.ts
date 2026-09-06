/** Original glTF operator with articulated named joints, equipment, and calibrated sockets. */
import { writeFile } from 'node:fs/promises'
import { expandInlineGeometry } from '../map-compiler/geometry'
const nodes: any[] = [],
    meshes: any[] = [],
    accessors: any[] = [],
    views: any[] = [],
    parts: Buffer[] = []
let length = 0
const materials = [
    ['fatigues', [0.26, 0.29, 0.21, 1]],
    ['armor', [0.19, 0.22, 0.17, 1]],
    ['webbing', [0.34, 0.32, 0.23, 1]],
    ['rubber', [0.07, 0.08, 0.07, 1]],
    ['metal', [0.13, 0.15, 0.15, 1]],
    ['skin', [0.47, 0.34, 0.24, 1]],
].map(([name, color]) => ({
    name,
    pbrMetallicRoughness: {
        baseColorFactor: color,
        metallicFactor: name === 'metal' ? 0.65 : 0,
        roughnessFactor: name === 'metal' ? 0.42 : 0.9,
    },
}))
function node(name: string, parent: number | null, position = [0, 0, 0]) {
    const id = nodes.length
    nodes.push({ name, translation: position, children: [] })
    if (parent !== null) nodes[parent].children.push(id)
    return id
}
function accessor(data: Float32Array | Uint32Array, type: string) {
    const bytes = Buffer.from(data.buffer),
        v = views.length
    views.push({ buffer: 0, byteOffset: length, byteLength: bytes.length })
    parts.push(bytes)
    length += bytes.length
    const result: any = {
        bufferView: v,
        componentType: data instanceof Float32Array ? 5126 : 5125,
        count: data.length / (type === 'VEC3' ? 3 : 1),
        type,
    }
    if (type === 'VEC3') {
        result.min = [0, 1, 2].map((a) => {
            let m = Infinity
            for (let i = a; i < data.length; i += 3) m = Math.min(m, data[i])
            return m
        })
        result.max = [0, 1, 2].map((a) => {
            let m = -Infinity
            for (let i = a; i < data.length; i += 3) m = Math.max(m, data[i])
            return m
        })
    }
    return accessors.push(result) - 1
}
function mesh(
    name: string,
    parent: number,
    p: number[][],
    ix: number[],
    mat: number
) {
    const pos: number[] = [],
        norm: number[] = []
    for (let i = 0; i < ix.length; i += 3) {
        const [a, b, c] = ix.slice(i, i + 3).map((j) => p[j]),
            u = b.map((x, j) => x - a[j]),
            v = c.map((x, j) => x - a[j]),
            n = [
                u[1] * v[2] - u[2] * v[1],
                u[2] * v[0] - u[0] * v[2],
                u[0] * v[1] - u[1] * v[0],
            ],
            l = Math.hypot(...n)
        for (const t of [a, b, c]) {
            pos.push(...t)
            norm.push(...n.map((x) => x / l))
        }
    }
    const id = node(name, parent)
    nodes[id].mesh = meshes.length
    meshes.push({
        primitives: [
            {
                attributes: {
                    POSITION: accessor(new Float32Array(pos), 'VEC3'),
                    NORMAL: accessor(new Float32Array(norm), 'VEC3'),
                },
                indices: accessor(
                    Uint32Array.from({ length: pos.length / 3 }, (_, i) => i),
                    'SCALAR'
                ),
                material: mat,
            },
        ],
    })
}
function box(
    name: string,
    parent: number,
    center: number[],
    size: number[],
    mat: number
) {
    const g = expandInlineGeometry({ shape: 'box', size }, name)
    mesh(
        name,
        parent,
        g.positions.map((p) => p.map((v, a) => v + center[a])),
        g.indices,
        mat
    )
}
function ellipsoid(
    name: string,
    parent: number,
    center: number[],
    scale: number[],
    mat: number
) {
    const p: number[][] = [],
        ix: number[] = [],
        n = 12,
        rings = 8
    p.push([center[0], center[1] - scale[1], center[2]])
    for (let y = 1; y < rings; y++) {
        const a = (y / rings) * Math.PI
        for (let x = 0; x < n; x++) {
            const b = (x / n) * Math.PI * 2
            p.push([
                center[0] + Math.sin(a) * Math.cos(b) * scale[0],
                center[1] - Math.cos(a) * scale[1],
                center[2] + Math.sin(a) * Math.sin(b) * scale[2],
            ])
        }
    }
    const top = p.length
    p.push([center[0], center[1] + scale[1], center[2]])
    for (let x = 0; x < n; x++) {
        const k = (x + 1) % n
        ix.push(
            0,
            1 + x,
            1 + k,
            top,
            1 + (rings - 2) * n + k,
            1 + (rings - 2) * n + x
        )
    }
    for (let y = 0; y < rings - 2; y++)
        for (let x = 0; x < n; x++) {
            const a = 1 + y * n + x,
                b = 1 + y * n + ((x + 1) % n),
                c = a + n,
                d = b + n
            ix.push(a, c, b, b, c, d)
        }
    mesh(name, parent, p, ix, mat)
}
const root = node('operator', null),
    calibration = node('calibration', root),
    torso = node('torso-joint', calibration, [0, 1.08, 0]),
    head = node('head-joint', torso, [0, 0.58, 0])
ellipsoid('jacket', torso, [0, 0.19, 0], [0.28, 0.36, 0.18], 0)
box('plate-carrier', torso, [0, 0.23, -0.15], [0.43, 0.42, 0.09], 1)
for (const x of [-0.15, -0.05, 0.05, 0.15])
    box('mag-pouch', torso, [x, 0.17, -0.215], [0.085, 0.18, 0.055], 2)
for (const x of [-0.19, 0.19])
    box('shoulder-strap', torso, [x, 0.44, -0.1], [0.065, 0.13, 0.15], 2)
box('backpack', torso, [0, 0.19, 0.205], [0.35, 0.4, 0.18], 2)
box('radio', torso, [0.24, 0.32, 0.04], [0.085, 0.17, 0.08], 3)
box('antenna', torso, [0.24, 0.57, 0.04], [0.008, 0.34, 0.008], 4)
ellipsoid('neck', torso, [0, 0.49, 0], [0.065, 0.09, 0.065], 5)
ellipsoid('head', head, [0, -0.025, 0], [0.115, 0.15, 0.11], 5)
ellipsoid('helmet', head, [0, 0.07, 0], [0.17, 0.12, 0.16], 1)
box('goggles', head, [0, 0.018, -0.115], [0.21, 0.055, 0.035], 3)
box('helmet-mount', head, [0, 0.1, -0.15], [0.065, 0.045, 0.025], 4)
box('face-wrap', head, [0, -0.07, -0.085], [0.19, 0.075, 0.065], 2)
box('belt', calibration, [0, 0.88, 0], [0.47, 0.1, 0.29], 3)
ellipsoid('trousers-hip', calibration, [0, 0.85, 0], [0.25, 0.19, 0.17], 0)
for (const [name, x] of [
    ['left', -0.31],
    ['right', 0.31],
] as const) {
    const arm = node(name + '-arm', torso, [x, 0.45, 0])
    ellipsoid('sleeve', arm, [0, -0.22, 0], [0.095, 0.24, 0.095], 0)
    ellipsoid('forearm', arm, [0, -0.47, 0], [0.078, 0.19, 0.078], 0)
    ellipsoid('glove', arm, [0, -0.66, 0], [0.07, 0.09, 0.075], 2)
    box('elbow-pad', arm, [0, -0.35, 0.07], [0.12, 0.12, 0.04], 1)
}
for (const [name, x] of [
    ['left', -0.15],
    ['right', 0.15],
] as const) {
    const leg = node(name + '-leg', calibration, [x, 0.82, 0])
    ellipsoid('thigh', leg, [0, -0.19, 0], [0.115, 0.24, 0.13], 0)
    ellipsoid('shin', leg, [0, -0.54, 0], [0.085, 0.23, 0.09], 0)
    box('knee-pad', leg, [0, -0.36, -0.105], [0.135, 0.16, 0.05], 1)
    ellipsoid('boot', leg, [0, -0.745, -0.06], [0.1, 0.085, 0.17], 3)
    box(
        'cargo-pocket',
        leg,
        [x < 0 ? -0.09 : 0.09, -0.2, 0],
        [0.08, 0.18, 0.17],
        2
    )
}
const sockets: Record<string, number[]> = {
    head: [0, 1.66, 0],
    name: [0, 2.04, 0],
    leftHand: [-0.29, 1.18, -0.28],
    rightHand: [0.29, 1.16, -0.22],
    weapon: [0.18, 1.2, -0.28],
    muzzle: [0.18, 1.2, -0.93],
}
let weapon = 0
for (const [name, pos] of Object.entries(sockets)) {
    const id = node('socket-' + name, calibration, pos)
    if (name === 'weapon') weapon = node('world-weapon', id)
}
box('world-receiver', weapon, [0, 0, -0.12], [0.065, 0.085, 0.28], 4)
box('world-stock', weapon, [0, -0.01, 0.14], [0.06, 0.1, 0.21], 1)
box('world-magazine', weapon, [0, -0.12, -0.09], [0.05, 0.2, 0.08], 1)
box('world-barrel', weapon, [0, 0, -0.43], [0.025, 0.025, 0.38], 4)
const gltf = {
    asset: {
        version: '2.0',
        generator: 'Iron Front original operator authoring',
    },
    scene: 0,
    scenes: [{ nodes: [root] }],
    nodes,
    meshes,
    materials,
    accessors,
    bufferViews: views,
    buffers: [
        {
            byteLength: length,
            uri:
                'data:application/octet-stream;base64,' +
                Buffer.concat(parts).toString('base64'),
        },
    ],
}
await writeFile('public/models/operator.gltf', JSON.stringify(gltf))
