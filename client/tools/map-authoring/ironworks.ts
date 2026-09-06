/** Original, deterministic modular level authoring. Units are metres. No external assets. */
import { writeFile } from 'node:fs/promises'
import { expandInlineGeometry } from '../map-compiler/geometry'
import type { Vec3 } from '../map-compiler/types'
const nodes: any[] = [],
    buckets = new Map<string, any>()
let serial = 0,
    seed = 311193
const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
}
const palette: Record<string, [number, number, number, number]> = {
    grass: [0.22, 0.29, 0.13, 1],
    concrete: [0.4, 0.42, 0.4, 1],
    plaster: [0.58, 0.57, 0.49, 1],
    steel: [0.17, 0.22, 0.22, 1],
    rust: [0.35, 0.18, 0.09, 1],
    paint: [0.22, 0.3, 0.26, 1],
    asphalt: [0.13, 0.15, 0.15, 1],
    earth: [0.24, 0.25, 0.17, 1],
    gravel: [0.34, 0.34, 0.29, 1],
    bark: [0.65, 0.65, 0.56, 1],
    pine: [0.12, 0.21, 0.13, 1],
    leaves: [0.28, 0.34, 0.13, 1],
    glass: [0.23, 0.36, 0.37, 1],
    yellow: [0.63, 0.43, 0.12, 1],
    water: [0.16, 0.23, 0.24, 1],
    wood: [0.29, 0.23, 0.14, 1],
    black: [0.075, 0.085, 0.08, 1],
    brick: [0.4, 0.27, 0.18, 1],
    white: [0.65, 0.64, 0.53, 1],
}
function geometry(
    name: string,
    mat: string,
    p: Vec3[],
    ix: number[],
    collision = true
) {
    const center = p.reduce(
        (sum, point) => [
            sum[0] + point[0] / p.length,
            sum[1] + point[1] / p.length,
            sum[2] + point[2] / p.length,
        ],
        [0, 0, 0]
    )
    for (const role of collision ? ['render', 'collision'] : ['render']) {
        const cell = [
            'earth',
            'leaves',
            'grass',
            'gravel',
            'pine',
            'bark',
        ].includes(mat)
            ? 48
            : 32
        const key = `${role}-${mat}-${Math.floor(center[0] / cell)}-${Math.floor(center[2] / cell)}`
        let b = buckets.get(key)
        if (!b) {
            b = {
                name: key,
                extras: {
                    mapRole: role,
                    geometry: { positions: [], indices: [] },
                    ...(role === 'render'
                        ? {
                              material: {
                                  name: `iron-${mat}`,
                                  baseColor: palette[mat],
                                  metallic: ['steel', 'rust', 'paint'].includes(
                                      mat
                                  )
                                      ? 0.65
                                      : 0,
                                  roughness:
                                      mat === 'water'
                                          ? 0.22
                                          : mat === 'glass'
                                            ? 0.3
                                            : 0.88,
                              },
                          }
                        : {}),
                },
            }
            buckets.set(key, b)
        }
        const g = b.extras.geometry,
            offset = g.positions.length
        g.positions.push(...p)
        g.indices.push(...ix.map((i) => i + offset))
    }
}
function box(
    name: string,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    mat: string,
    collision = true,
    yaw = 0,
    shape = 'box'
) {
    const g = expandInlineGeometry({ shape, size: [w, h, d] }, name),
        c = Math.cos(yaw),
        s = Math.sin(yaw)
    geometry(
        name,
        mat,
        g.positions.map(([a, b, e]) => [
            x + a * c + e * s,
            y + b,
            z - a * s + e * c,
        ]),
        g.indices,
        collision
    )
}
function cylinder(
    name: string,
    x: number,
    y: number,
    z: number,
    r: number,
    h: number,
    mat: string,
    collision = true,
    top = r,
    axis = 'y'
) {
    const p: Vec3[] = [],
        ix: number[] = [],
        n = 12
    for (let j = 0; j < 2; j++)
        for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2,
                rad = j ? top : r
            const v = [Math.cos(a) * rad, (j - 0.5) * h, Math.sin(a) * rad]
            p.push(
                axis === 'z'
                    ? [x + v[0], y + v[2], z + v[1]]
                    : [x + v[0], y + v[1], z + v[2]]
            )
        }
    p.push(
        axis === 'z' ? [x, y, z - h / 2] : [x, y - h / 2, z],
        axis === 'z' ? [x, y, z + h / 2] : [x, y + h / 2, z]
    )
    for (let i = 0; i < n; i++) {
        const k = (i + 1) % n
        ix.push(
            i,
            k,
            n + k,
            i,
            n + k,
            n + i,
            2 * n,
            k,
            i,
            2 * n + 1,
            n + i,
            n + k
        )
    }
    geometry(name, mat, p, ix, collision)
}
function crown(x: number, y: number, z: number, r: number, h: number) {
    const points: Vec3[] = [],
        indices: number[] = [],
        segments = 10,
        rings = 6
    for (let j = 0; j <= rings; j++)
        for (let i = 0; i <= segments; i++) {
            const lat = (j / rings) * Math.PI,
                lon = (i / segments) * Math.PI * 2,
                irregular = 1 + 0.15 * Math.sin(lon * 3 + lat * 5)
            points.push([
                x + Math.sin(lat) * Math.cos(lon) * r * irregular,
                y + Math.cos(lat) * h * 0.5,
                z + Math.sin(lat) * Math.sin(lon) * r * irregular,
            ])
        }
    for (let j = 0; j < rings; j++)
        for (let i = 0; i < segments; i++) {
            const a = j * (segments + 1) + i,
                b = a + segments + 1
            if (j > 0) indices.push(a, b, a + 1)
            if (j < rings - 1) indices.push(a + 1, b, b + 1)
        }
    geometry('birch-crown', 'leaves', points, indices, false)
}
function marker(id: string, type: string, position: Vec3) {
    nodes.push({
        name: id,
        translation: position,
        extras: { mapRole: 'marker', markerType: type },
    })
}
function zone(id: string, type: string, position: Vec3, size: Vec3) {
    nodes.push({
        name: id,
        translation: position,
        extras: { mapRole: 'zone', zoneType: type, size },
    })
}
function spawn(
    id: string,
    x: number,
    z: number,
    team: string | null = null,
    y = 0.08
) {
    nodes.push({
        name: id,
        translation: [x, y, z],
        extras: {
            mapRole: 'spawn',
            modes: ['ffa', 'conquest'],
            team,
            yaw: team === 'east' ? -Math.PI / 2 : Math.PI / 2,
        },
    })
}
// 448 × 336 m operational area; layered ground makes a real below-grade service gallery.
box('bedrock', 0, -4.5, 0, 448, 1, 336, 'earth')
// Flat ground uses four slabs; this avoids thousands of buried faces and dozens of draws.
for (const x of [-154, 154]) box('terrain', x, -0.3, 0, 140, 0.6, 336, 'earth')
for (const z of [-90, 90]) box('terrain', 0, -0.3, z, 168, 0.6, 156, 'earth')
box('gallery-lid', 0, -0.25, 0, 140, 0.5, 24, 'concrete')
box('gallery-floor', 0, -3.2, 0, 168, 0.4, 8, 'concrete')
for (const z of [-4.3, 4.3])
    box('gallery-wall', 0, -1.6, z, 168, 3.2, 0.6, 'concrete')
for (const x of [-76, 76])
    box(
        'access-ramp',
        x,
        -1.5,
        0,
        8,
        3,
        16,
        'concrete',
        true,
        x < 0 ? -Math.PI / 2 : Math.PI / 2,
        'ramp'
    )
for (const x of [-77, 77])
    for (const z of [-8, 8])
        box('entrance-shoulder', x, -1.6, z, 14, 3.2, 8, 'earth')
zone('gallery-reverb', 'reverb', [0, -1.5, 0], [166, 3, 8])
// Roads and rail corridors have cover every 12–20 metres, with future vehicle clearances.
for (const z of [-100, 100])
    box('perimeter-road', 0, 0.015, z, 408, 0.03, 12, 'asphalt', false)
for (const x of [-128, 128])
    box('cross-road', x, 0.018, 0, 12, 0.036, 290, 'asphalt', false)
for (const z of [-100, 100])
    for (let x = -196; x <= 196; x += 14)
        box('road-dash', x, 0.04, z, 5, 0.025, 0.14, 'white', false)
box('central-yard', 0, 0.025, 0, 18, 0.05, 192, 'gravel', false)
for (const x of [-103, -99]) box('rail', x, 0.13, 0, 0.15, 0.22, 280, 'rust')
for (let z = -138; z < 140; z += 2.2)
    box('sleeper', -101, 0.06, z, 7, 0.12, 0.25, 'wood', false)
function stairs(x: number, z: number, yaw = 0) {
    for (let i = 0; i < 20; i++) {
        const h = (i + 1) * 0.2
        box(
            'stair',
            x + Math.sin(yaw) * (i * 0.3 - 3),
            h / 2,
            z + Math.cos(yaw) * (i * 0.3 - 3),
            2.4,
            h,
            0.31,
            'concrete',
            true,
            yaw
        )
    }
}
function factory(cx: number, label: string) {
    box('apron', cx, 0.02, 0, 60, 0.04, 104, 'concrete', false)
    // 52 × 88 m hall; 9 m eaves, 4 m mezzanine. Open loading bays on every side.
    for (const side of [-1, 1]) {
        for (let z = -40; z <= 40; z += 8) {
            box('column', cx + side * 26, 4.5, z, 0.55, 9, 0.7, 'concrete')
            box('wall-panel', cx + side * 26, 2.2, z, 0.28, 4.4, 5.1, 'brick')
            box(
                'clerestory',
                cx + side * 26,
                6.5,
                z,
                0.12,
                2.6,
                6.8,
                'glass',
                false
            )
            box(
                'window-transom',
                cx + side * 26,
                6.5,
                z,
                0.22,
                0.09,
                7,
                'steel',
                false
            )
            for (const dz of [-2, 0, 2])
                box(
                    'mullion',
                    cx + side * 26,
                    6.5,
                    z + dz,
                    0.24,
                    2.7,
                    0.08,
                    'steel',
                    false
                )
        }
        for (const z of [-44, 44])
            for (const dx of [-19, 19])
                box('end-wall', cx + dx, 4.4, z, 14, 8.8, 0.4, 'plaster')
        box('end-lintel', cx, 7.8, side * 44, 24, 2.2, 0.5, 'plaster')
        // Stair wells leave standing headroom throughout each 4 m ascent.
        box('catwalk', cx + side * 21, 3.9, 0, 8, 0.2, 62, 'steel')
        box('catwalk-bypass', cx + side * 24.2, 3.9, 0, 1.6, 0.2, 80, 'steel')
        for (const end of [-39, 39])
            box('catwalk-end', cx + side * 21, 3.9, end, 8, 0.2, 2, 'steel')
        for (let z = -38; z <= 38; z += 4)
            box(
                'baluster',
                cx + side * 17,
                4.6,
                z,
                0.06,
                1.2,
                0.06,
                'steel',
                false
            )
        for (const y of [4.4, 5])
            box(
                'guardrail',
                cx + side * 17,
                y,
                0,
                0.08,
                0.08,
                78,
                'yellow',
                true
            )
        stairs(cx + side * 21, -34)
        stairs(cx + side * 21, 34, Math.PI)
    }
    for (let z = -40; z <= 40; z += 8) {
        box('roof-truss', cx, 8.6, z, 52, 0.32, 0.25, 'rust', false)
        box('crane-rail', cx, 6.7, z, 48, 0.25, 0.22, 'yellow', false)
    }
    for (const dx of [-16, 16])
        box('roof', cx + dx, 9, 0, 20, 0.24, 90, 'steel')
    for (let z = -40; z <= 40; z += 10)
        box('roof-sky-frame', cx, 9, z, 12, 0.18, 0.18, 'steel', false)
    // Broken tracked chassis, rollers, presses and fragmented production lanes.
    for (const z of [-26, -8, 14, 30])
        for (const side of [-1, 1]) {
            const x = cx + side * 8
            box('assembly-pedestal', x, 0.4, z, 4.8, 0.8, 7, 'concrete')
            box('hull', x, 1.25, z, 3.2, 1, 5.4, 'paint')
            cylinder('turret', x, 2.1, z, 1.15, 0.7, 'paint')
            cylinder(
                'gun',
                x,
                2.2,
                z - 2.5,
                0.12,
                3.4,
                'steel',
                true,
                0.12,
                'z'
            )
            for (const sx of [-1.65, 1.65])
                box('track', x + sx, 0.95, z, 0.55, 0.8, 5.6, 'black')
            for (let i = -2; i <= 2; i++)
                cylinder(
                    'roller',
                    x + i * 0.7,
                    0.6,
                    z + 4,
                    0.2,
                    2.4,
                    'steel',
                    false,
                    0.2,
                    'z'
                )
        }
    box('gantry', cx, 7.2, 17, 46, 0.8, 2.2, 'yellow', false)
    box('hoist', cx + 4, 6.4, 17, 1.5, 1.1, 1.6, 'steel', false)
    cylinder('cable', cx + 4, 4.4, 17, 0.035, 3, 'black', false)
    zone(`${label}-interior`, 'reverb', [cx, 4, 0], [51, 8, 86])
    marker(`${label}-hall`, 'landmark', [cx, 0, 0])
}
factory(-42, 'assembly')
factory(42, 'forge')
function container(x: number, z: number, yaw = 0) {
    box('container', x, 1.3, z, 2.5, 2.6, 6, 'paint', true, yaw)
    for (let i = -2.8; i < 3; i += 0.4)
        for (const side of [-1, 1])
            box(
                'corrugation',
                x + side * 1.27,
                1.3,
                z + i,
                0.06,
                2.5,
                0.08,
                'steel',
                false,
                yaw
            )
}
for (const x of [102, 111, 147, 156])
    for (const z of [-53, -42, 36, 47]) container(x, z)
// Rail yard: separated cars provide firing gaps and covered route to A.
for (const z of [-71, -51, -9, 14, 62]) {
    box('railcar-deck', -101, 1.1, z, 3.4, 0.3, 12, 'rust')
    for (const side of [-1, 1])
        box('railcar-side', -101 + side * 1.7, 2, z, 0.16, 1.7, 12, 'rust')
    for (const dz of [-4, 4]) {
        cylinder(
            'bogie',
            -101,
            0.5,
            z + dz,
            0.48,
            2.6,
            'black',
            true,
            0.48,
            'z'
        )
    }
    box('rail-cargo', -101, 1.8, z, 2.6, 1.2, 6, 'wood')
}
// North service warehouse and south boiler plant.
for (const [x, z] of [
    [0, 124],
    [12, -126],
    [-157, 26],
    [163, -17],
]) {
    box('warehouse-slab', x, 0.12, z, 28, 0.24, 24, 'concrete')
    for (const s of [-1, 1]) {
        box('warehouse-side', x + s * 14, 3, z, 0.4, 6, 24, 'plaster')
        box('warehouse-back', x + s * 9, 3, z + 12, 10, 6, 0.4, 'brick')
    }
    box('warehouse-lintel', x, 5.2, z - 12, 28, 1.6, 0.4, 'plaster')
    box('warehouse-roof', x, 6.2, z, 30, 0.25, 26, 'rust')
    for (const dx of [-7, 7])
        box('warehouse-crate', x + dx, 1, z, 3, 2, 4, 'wood')
}
for (const x of [-29, -20, 38]) {
    cylinder('storage-tank', x, 3.7, -128, 3.5, 7.4, 'rust')
    cylinder('tank-cap', x, 7.5, -128, 3.6, 0.25, 'steel')
    cylinder('steam-stack', x, 15, -140, 1.25, 30, 'brick')
}
for (const x of [-30, 30]) {
    cylinder('pipe', x, 2, -72, 0.28, 36, 'rust', true, 0.28, 'z')
    for (const z of [-85, -71, -59])
        box('pipe-support', x, 1, z, 1.2, 2, 0.6, 'concrete')
}
// Ancillary pump houses, revetments, pallets and concrete bays break exterior sightlines.
for (const x of [-154, 154])
    for (const z of [-72, 78]) {
        box('pump-pad', x, 0.1, z, 12, 0.2, 14, 'concrete')
        box('pump-back', x, 2, z + 6, 12, 4, 0.3, 'plaster')
        box('pump-side', x - 6, 2, z, 0.3, 4, 12, 'plaster')
        box('pump-roof', x, 4.2, z, 13, 0.25, 14, 'rust')
        cylinder('pump-vessel', x + 2, 1.5, z, 1, 3, 'paint')
        cylinder('pump-feed', x - 2, 1.8, z, 0.18, 7, 'rust', true, 0.18, 'z')
    }
for (const x of [-82, 82])
    for (const z of [-72, 69]) {
        box('revetment', x, 0.8, z, 9, 1.6, 0.65, 'concrete')
        box('revetment-return', x + 4, 0.8, z + 3, 0.65, 1.6, 6, 'concrete')
        for (let i = 0; i < 4; i++)
            cylinder('drum', x - 2 + i * 0.65, 0.5, z + 2, 0.28, 1, 'rust')
    }
for (let i = 0; i < 38; i++) {
    const x = -115 + random() * 230,
        z = (i % 2 ? -1 : 1) * (58 + random() * 29)
    box('pallet', x, 0.13, z, 1.2, 0.26, 1, 'wood')
    for (let j = 0; j < 3; j++)
        box(
            'pallet-board',
            x,
            0.28,
            z - 0.4 + j * 0.4,
            1.2,
            0.05,
            0.18,
            'wood',
            false
        )
    if (i % 3 === 0) box('supply-crate', x, 0.65, z, 1, 1, 0.8, 'paint')
}
// Woodland flanks, scattered revetments, weathering and infantry micro-cover.
for (let i = 0; i < 1200; i++) {
    const x = (random() - 0.5) * 424,
        z = (random() - 0.5) * 310
    if (
        (Math.abs(x) < 169 && Math.abs(z) < 136) ||
        Math.abs(Math.abs(z) - 100) < 9 ||
        Math.abs(Math.abs(x) - 128) < 10
    )
        continue
    const h = 7 + random() * 9,
        birch = i % 3 === 0
    cylinder(
        'tree',
        x,
        h / 2,
        z,
        birch ? 0.18 : 0.3,
        h,
        birch ? 'bark' : 'wood',
        true,
        0.1
    )
    if (birch) {
        crown(x, h * 0.75, z, 2.7, 5.5)
        crown(x + 0.8, h * 0.57, z - 0.4, 1.9, 3.3)
    } else
        for (let j = 0; j < 4; j++)
            cylinder(
                'canopy',
                x,
                h * 0.47 + j * 1.6,
                z,
                3.0 - j * 0.55,
                3.9,
                'pine',
                false,
                0.12
            )
}
for (const x of [-175, -145, -80, 80, 145, 175])
    for (let z = -132; z < 140; z += 22) {
        if (Math.abs(z) < 51 && Math.abs(x) === 80) continue
        box(
            'barrier',
            x,
            0.65,
            z,
            4.2,
            1.3,
            0.65,
            'concrete',
            true,
            random() * 0.4
        )
        for (let i = 0; i < 5; i++) {
            const dx = random() * 7 - 3.5,
                dz = random() * 6 - 3
            box(
                'rubble',
                x + dx,
                0.12,
                z + dz,
                0.3 + random() * 0.6,
                0.24,
                0.4,
                'gravel',
                false,
                random() * 6
            )
        }
    }
for (let i = 0; i < 2400; i++) {
    const x = (random() - 0.5) * 420,
        z = (random() - 0.5) * 310
    if (
        (Math.abs(x) < 72 && Math.abs(z) < 48) ||
        Math.abs(Math.abs(z) - 100) < 7 ||
        Math.abs(Math.abs(x) - 128) < 7
    )
        continue
    const h = 0.18 + random() * 0.5
    for (let j = 0; j < 5; j++) {
        const angle = random() * Math.PI * 2,
            dx = Math.cos(angle),
            dz = Math.sin(angle),
            w = 0.025 + random() * 0.025,
            bend = 0.1 + random() * 0.16
        geometry(
            'grass-blade',
            'grass',
            [
                [x - dx * w, 0, z - dz * w],
                [x + dx * w, 0, z + dz * w],
                [x + dx * bend, h, z + dz * bend],
            ],
            [0, 1, 2],
            false
        )
    }
}
for (let i = 0; i < 95; i++) {
    const x = (random() - 0.5) * 138,
        z = (random() - 0.5) * 180
    if (Math.abs(z) < 6) continue
    box(
        'oil-stain',
        x,
        0.055,
        z,
        1 + random() * 3,
        0.008,
        1 + random() * 5,
        i % 4 === 0 ? 'water' : 'black',
        false,
        random() * 3
    )
}
for (const side of [-1, 1])
    for (let i = 0; i < 8; i++)
        spawn(
            `${side < 0 ? 'west' : 'east'}-hq-${i}`,
            side * (198 - (i % 2) * 5),
            -21 + Math.floor(i / 2) * 14,
            side < 0 ? 'west' : 'east'
        )
const objectives: [string, number, number][] = [
    ['a-railhead', -103, 75],
    ['b-assembly', -42, 18],
    ['c-forge', 42, -18],
    ['d-storage', 128, 53],
    ['e-boiler', 0, -126],
]
for (const [id, x, z] of objectives) {
    marker(id, 'objective', [x, 0.1, z])
    zone(id + '-capture', 'objective', [x, 2, z], [24, 5, 24])
    cylinder('flagpole', x + 4, 4, z, 0.055, 8, 'steel', false)
    box('flag', x + 5, 7, z, 1.8, 0.85, 0.03, 'yellow', false)
    for (let i = 0; i < 3; i++) spawn(`${id}-spawn-${i}`, x - 5 + i * 5, z + 8)
}
const nav = [
    ['west', -193, 0],
    ['rail', -101, 75],
    ['north', 0, 100],
    ['assembly', -42, 18],
    ['forge', 42, -18],
    ['storage', 128, 53],
    ['east', 193, 0],
    ['south', 0, -100],
    ['boiler', 0, -126],
    ['flank-west', -175, -100],
    ['flank-east', 175, 100],
] as const
for (let i = 0; i < nav.length; i++) {
    const [id, x, z] = nav[i]
    nodes.push({
        name: `nav-${id}`,
        translation: [x, 0.1, z],
        extras: {
            mapRole: 'navigation',
            links: nav
                .filter(
                    (_, j) =>
                        j !== i &&
                        Math.hypot(nav[j][1] - x, nav[j][2] - z) < 170
                )
                .map((n) => `nav-${n[0]}`),
        },
    })
}
const galleryRoutes: [string, Vec3, string[]][] = [
    ['gallery-west-entry', [-86, 0.1, 0], ['west', 'rail', 'gallery-west']],
    ['gallery-west', [-68, -2.9, 0], ['gallery-west-entry', 'gallery-center']],
    ['gallery-center', [0, -2.9, 0], ['gallery-west', 'gallery-east']],
    ['gallery-east', [68, -2.9, 0], ['gallery-center', 'gallery-east-entry']],
    ['gallery-east-entry', [86, 0.1, 0], ['east', 'storage', 'gallery-east']],
]
for (const [id, position, links] of galleryRoutes)
    nodes.push({
        name: 'nav-' + id,
        translation: position,
        extras: {
            mapRole: 'navigation',
            links: links.map((link) => 'nav-' + link),
        },
    })
for (const [id, target] of [
    ['west', 'gallery-west-entry'],
    ['rail', 'gallery-west-entry'],
    ['east', 'gallery-east-entry'],
    ['storage', 'gallery-east-entry'],
])
    nodes.find((n) => n.name === 'nav-' + id).extras.links.push('nav-' + target)
zone('operational-area', 'playable', [0, 10, 0], [440, 28, 328])
nodes.push({ name: 'tactical-radar', extras: { mapRole: 'radar' } })
// Terrain perimeter is authoritative, backed by four authored perimeter walls.
for (const x of [-223.5, 223.5]) box('boundary', x, 2, 0, 1, 4, 336, 'earth')
for (const z of [-167.5, 167.5]) box('boundary', 0, 2, z, 448, 4, 1, 'earth')
const source = {
    asset: {
        version: '2.0',
        generator: 'Ironworks modular authoring / original project assets',
    },
    scene: 0,
    scenes: [{ nodes: [] as number[] }],
    extras: {
        map: {
            id: 'ironworks',
            bounds: { min: [-224, -5, -168], max: [224, 40, 168] },
            environment: {
                clearColor: [0.43, 0.51, 0.54],
                exposure: 1.1,
                sunDirection: [-0.55, -0.72, 0.36],
                shadowDistance: 140,
            },
            policy: {
                stepSmoothingMax: 0.42,
                audioDistanceScale: 2,
                radarNorthYaw: 0,
            },
        },
    },
    nodes: [...buckets.values(), ...nodes],
}
source.scenes[0].nodes = source.nodes.map((_, i) => i)
await writeFile('maps/ironworks.gltf', JSON.stringify(source))
console.log(
    `Authored ironworks: ${buckets.size} spatial/material chunks, ${nodes.length} metadata nodes`
)
