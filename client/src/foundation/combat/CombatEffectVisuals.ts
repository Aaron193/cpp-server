import { Color3 } from '@babylonjs/core/Maths/math.color.js'
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js'
import { Constants } from '@babylonjs/core/Engines/constants.js'
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture.js'
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js'
import { Material } from '@babylonjs/core/Materials/material.js'
import { Mesh } from '@babylonjs/core/Meshes/mesh.js'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js'
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js'
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder.js'
import type { Scene } from '@babylonjs/core/scene.js'

export type EffectTexture =
    | 'tracer'
    | 'flash'
    | 'smoke'
    | 'spark'
    | 'blood'
    | 'hole'
const clamp = (v: number) => Math.max(0, Math.min(1, v))

/** Small, original procedural textures generated once, with no asset downloads or canvas dependency. */
export function effectMaterial(
    scene: Scene,
    kind: EffectTexture
): StandardMaterial {
    const size = 128,
        bytes = new Uint8Array(size * size * 4)
    for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
            const u = x / (size - 1),
                v = y / (size - 1),
                px = u * 2 - 1,
                py = v * 2 - 1
            const r = Math.hypot(px, py),
                angle = Math.atan2(py, px)
            const noise = (Math.sin(x * 127.1 + y * 311.7) * 43758.5453) % 1
            const lobes =
                1 + 0.12 * Math.sin(angle * 7 + 1) + 0.08 * Math.cos(angle * 13)
            let alpha = 0,
                red = 1,
                green = 0.64,
                blue = 0.2
            if (kind === 'tracer') {
                const width = Math.max(0.06, Math.pow(u, 0.45))
                const core = Math.exp(-Math.pow(py / (0.22 * width), 2))
                alpha =
                    (core * 0.9 +
                        Math.exp(-Math.pow(py / (0.42 * width), 2)) * 0.18) *
                    Math.pow(Math.sin(Math.PI * u), 0.45)
                green = 0.36 + core * 0.59
                blue = 0.08 + core * 0.68
            } else if (kind === 'flash') {
                const petals = Math.pow(Math.abs(Math.cos(angle * 3 + 0.6)), 16)
                const flame =
                    Math.exp(-r * r * 12) + petals * Math.exp(-r * r * 4) * 0.7
                alpha = flame * clamp((1 - r) * 5) * (0.82 + noise * 0.16)
                green = 0.38 + Math.exp(-r * r * 24) * 0.59
                blue = 0.035 + Math.exp(-r * r * 36) * 0.8
            } else if (kind === 'hole') {
                // A quiet round recess and soft rim, without spiral/crack harmonics.
                const edge = r * (1 + 0.018 * Math.sin(angle * 5))
                const pit = 1 - clamp((edge - 0.22) / 0.13)
                const lip = Math.exp(-Math.pow((edge - 0.39) / 0.085, 2))
                alpha =
                    clamp((0.72 - edge) / 0.28) *
                    (0.42 + pit * 0.58 + lip * 0.2)
                red =
                    green =
                    blue =
                        clamp(0.12 + lip * (0.14 + py * 0.06) - pit * 0.09)
            } else {
                alpha =
                    Math.pow(clamp(1 - r * lobes), kind === 'spark' ? 3 : 1.8) *
                    (0.76 + noise * 0.2)
                if (kind === 'smoke') {
                    red = 0.48
                    green = 0.45
                    blue = 0.4
                }
                if (kind === 'blood') {
                    red = 0.31
                    green = 0.025
                    blue = 0.018
                }
            }
            const i = (y * size + x) * 4
            bytes[i] = clamp(red) * 255
            bytes[i + 1] = clamp(green) * 255
            bytes[i + 2] = clamp(blue) * 255
            bytes[i + 3] = clamp(alpha) * 255
        }
    const texture = RawTexture.CreateRGBATexture(
        bytes,
        size,
        size,
        scene,
        true,
        false,
        Texture.TRILINEAR_SAMPLINGMODE
    )
    texture.name = `effects/${kind}/texture`
    texture.hasAlpha = true
    texture.wrapU = texture.wrapV = Texture.CLAMP_ADDRESSMODE
    const material = new StandardMaterial(`effects/${kind}`, scene)
    material.diffuseTexture = texture
    material.useAlphaFromDiffuseTexture = true
    material.transparencyMode = Material.MATERIAL_ALPHABLEND
    material.specularColor = Color3.Black()
    material.backFaceCulling = false
    material.disableDepthWrite = true
    if (kind === 'tracer' || kind === 'spark') material.fogEnabled = false
    if (kind === 'hole') {
        material.diffuseColor.set(0.85, 0.85, 0.85)
        material.zOffset = -2
        material.zOffsetUnits = -2
    } else {
        material.disableLighting = true
        material.emissiveColor = Color3.White()
        material.diffuseColor = Color3.Black()
        material.emissiveTexture = texture
        if (kind !== 'smoke' && kind !== 'blood')
            material.alphaMode = Constants.ALPHA_ADD
    }
    return material
}

export function effectBillboard(
    name: string,
    scene: Scene,
    material: StandardMaterial
): Mesh {
    const mesh = CreatePlane(name, { size: 1 }, scene)
    mesh.material = material
    mesh.isPickable = false
    mesh.billboardMode = Mesh.BILLBOARDMODE_ALL
    mesh.setEnabled(false)
    return mesh
}

export interface Ribbon {
    mesh: Mesh
    positions: Float32Array
}
export function createRibbon(
    name: string,
    scene: Scene,
    material: StandardMaterial
): Ribbon {
    const mesh = new Mesh(name, scene),
        positions = new Float32Array(12)
    const data = new VertexData()
    data.positions = positions
    data.indices = [0, 1, 2, 2, 1, 3]
    data.uvs = [0, 0, 0, 1, 1, 0, 1, 1]
    data.normals = [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]
    data.applyToMesh(mesh, true)
    mesh.material = material
    mesh.isPickable = false
    mesh.setEnabled(false)
    return { mesh, positions }
}
const axis = new Vector3(),
    view = new Vector3(),
    side = new Vector3()
/** View-facing world-space ribbon: readable from any angle, still depth-tested against cover. */
export function positionRibbon(
    ribbon: Ribbon,
    tail: Vector3,
    head: Vector3,
    eye: Vector3,
    width: number
): void {
    const mesh = ribbon.mesh
    Vector3.LerpToRef(tail, head, 0.5, mesh.position)
    head.subtractToRef(tail, axis)
    eye.subtractToRef(mesh.position, view)
    Vector3.CrossToRef(axis, view, side)
    if (side.lengthSquared() < 0.000001)
        Vector3.CrossToRef(view, Vector3.UpReadOnly, side)
    if (side.lengthSquared() < 0.000001) side.set(1, 0, 0)
    side.normalize().scaleInPlace(width * 0.5)
    for (let i = 0; i < 4; i++) {
        const p = i < 2 ? tail : head,
            sign = i % 2 === 0 ? -1 : 1,
            offset = i * 3
        ribbon.positions[offset] = p.x - mesh.position.x + side.x * sign
        ribbon.positions[offset + 1] = p.y - mesh.position.y + side.y * sign
        ribbon.positions[offset + 2] = p.z - mesh.position.z + side.z * sign
    }
    mesh.updateVerticesData(VertexBuffer.PositionKind, ribbon.positions, true)
}
