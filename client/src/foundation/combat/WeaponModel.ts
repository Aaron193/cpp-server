import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder.js'
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder.js'
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder.js'
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder.js'
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js'
import { Color3 } from '@babylonjs/core/Maths/math.color.js'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js'
import { Mesh } from '@babylonjs/core/Meshes/mesh.js'
import type { Camera } from '@babylonjs/core/Cameras/camera.js'
import type { Scene } from '@babylonjs/core/scene.js'
import { Weapon } from '../../protocol/generated'

export interface WeaponRig {
    root: TransformNode
    muzzle: TransformNode
    optic: TransformNode
    magazine: TransformNode
    leftHand: TransformNode
}
/** Original modular AR-28 geometry. Nodes are socket-named for future authored GLB replacement. */
export function buildWeaponModel(
    weapon: Weapon,
    camera: Camera,
    scene: Scene
): WeaponRig {
    const prefix = `viewmodel/${weapon === Weapon.Rifle ? 'ar28' : 'sg12'}`,
        root = new TransformNode(prefix, scene)
    root.parent = camera
    const mat = (
        name: string,
        r: number,
        g: number,
        b: number,
        metallic: number,
        roughness: number
    ) => {
        const m = new PBRMaterial(prefix + '/' + name, scene)
        m.albedoColor = new Color3(r, g, b)
        m.metallic = metallic
        m.roughness = roughness
        m.environmentIntensity = 0.5
        m.directIntensity = 1.4
        return m
    }
    const metal = mat('anodized', 0.105, 0.12, 0.12, 0.75, 0.43),
        polymer = mat('polymer', 0.17, 0.18, 0.15, 0, 0.79),
        edge = mat('exposed-steel', 0.3, 0.33, 0.33, 0.85, 0.28),
        glove = mat('glove', 0.22, 0.21, 0.16, 0, 0.95),
        sleeve = mat('sleeve', 0.29, 0.31, 0.24, 0, 0.92)
    const attach = (
        m: Mesh,
        p: TransformNode,
        x: number,
        y: number,
        z: number,
        material: PBRMaterial
    ) => {
        m.parent = p
        m.position.set(x, y, z)
        m.material = material
        m.isPickable = false
        m.renderingGroupId = 1
        return m
    }
    const box = (
        name: string,
        x: number,
        y: number,
        z: number,
        w: number,
        h: number,
        d: number,
        m = metal,
        p = root
    ) =>
        attach(
            CreateBox(
                prefix + '/' + name,
                { width: w, height: h, depth: d },
                scene
            ),
            p,
            x,
            y,
            z,
            m
        )
    const tube = (
        name: string,
        x: number,
        y: number,
        z: number,
        r: number,
        l: number,
        m = metal,
        p = root
    ) => {
        const mesh = attach(
            CreateCylinder(
                prefix + '/' + name,
                { diameter: r * 2, height: l, tessellation: 16 },
                scene
            ),
            p,
            x,
            y,
            z,
            m
        )
        mesh.rotation.x = Math.PI / 2
        return mesh
    }
    box('upper-receiver', 0, 0, -0.12, 0.075, 0.09, 0.29)
    box('lower-receiver', 0, -0.065, -0.055, 0.067, 0.07, 0.18)
    tube('buffer-tube', 0, -0.005, 0.13, 0.024, 0.19)
    box('stock', 0, -0.03, 0.24, 0.066, 0.105, 0.2, polymer)
    box('buttpad', 0, -0.036, 0.34, 0.069, 0.14, 0.025, polymer)
    const grip = box(
        'pistol-grip',
        0,
        -0.155,
        0.04,
        0.055,
        0.16,
        0.067,
        polymer
    )
    grip.rotation.x = -0.25
    box('trigger-guard', 0, -0.12, -0.025, 0.025, 0.012, 0.095)
    box('trigger', 0, -0.09, -0.033, 0.008, 0.043, 0.01, edge)
    tube('handguard', 0, 0.0, -0.42, 0.045, 0.32, polymer)
    tube(
        'barrel',
        0,
        0,
        -0.69,
        weapon === Weapon.Shotgun ? 0.023 : 0.013,
        0.25,
        edge
    )
    tube('flash-hider', 0, 0, -0.835, 0.022, 0.045)
    for (let i = 0; i < 11; i++) {
        box(
            'top-rail-' + i,
            0,
            0.055,
            -0.49 + i * 0.031,
            0.055,
            0.015,
            0.015,
            edge
        )
        for (const sign of [-1, 1])
            box(
                'vent-' + i,
                sign * 0.044,
                0,
                -0.53 + i * 0.025,
                0.005,
                0.019,
                0.012,
                metal
            )
    }
    box('charging-handle', 0, 0.026, 0.025, 0.103, 0.012, 0.024, edge)
    box('ejection-port', 0.039, 0.005, -0.09, 0.006, 0.031, 0.083, edge)
    box('dust-cover', 0.043, -0.018, -0.09, 0.006, 0.013, 0.087, polymer)
    for (const z of [-0.21, -0.04])
        tube('receiver-pin', 0.039, -0.036, z, 0.007, 0.01, edge).rotation.z =
            Math.PI / 2
    const magazine = new TransformNode(prefix + '/magazine-joint', scene)
    magazine.parent = root
    magazine.position.set(0, -0.095, -0.125)
    magazine.rotation.x = 0.12
    box('magazine-body', 0, -0.1, 0, 0.054, 0.2, 0.085, polymer, magazine)
    box('magazine-base', 0, -0.205, 0, 0.061, 0.018, 0.091, edge, magazine)
    for (let i = 0; i < 4; i++)
        for (const side of [-1, 1])
            box(
                'magazine-groove',
                side * 0.028,
                -0.045 - i * 0.039,
                0,
                0.004,
                0.012,
                0.069,
                metal,
                magazine
            )
    // Open reflex aperture, with its centre calibrated exactly to the camera ray in ADS.
    box('optic-mount', 0, 0.067, -0.24, 0.061, 0.026, 0.1, metal)
    const opticRing = attach(
        CreateTorus(
            prefix + '/optic-frame',
            { diameter: 0.085, thickness: 0.008, tessellation: 24 },
            scene
        ),
        root,
        0,
        0.112,
        -0.24,
        metal
    )
    opticRing.rotation.x = Math.PI / 2
    const dotMaterial = mat('optic-emitter', 0.9, 0.12, 0.06, 0, 1)
    dotMaterial.emissiveColor = new Color3(1, 0.08, 0.015)
    attach(
        CreateSphere(
            prefix + '/optic-dot',
            { diameter: 0.002, segments: 6 },
            scene
        ),
        root,
        0,
        0.112,
        -0.26,
        dotMaterial
    )
    box('optic-hood-left', -0.047, 0.102, -0.24, 0.012, 0.084, 0.06, metal)
    box('optic-hood-right', 0.047, 0.102, -0.24, 0.012, 0.084, 0.06, metal)
    const leftHand = new TransformNode(prefix + '/left-hand-joint', scene)
    leftHand.parent = root
    leftHand.position.set(-0.055, -0.065, -0.4)
    for (const [p, x, y, z] of [
        [leftHand, 0, 0, 0],
        [root, 0.035, -0.16, 0.06],
    ] as const) {
        const palm = attach(
            CreateSphere(
                prefix + '/glove',
                { diameter: 1, segments: 12 },
                scene
            ),
            p,
            x,
            y,
            z,
            glove
        )
        palm.scaling.set(0.085, 0.1, 0.12)
        for (let i = 0; i < 4; i++) {
            const finger = tube(
                'finger',
                x - 0.025 + i * 0.016,
                y + 0.025,
                z - 0.035,
                0.009,
                0.075,
                glove,
                p
            )
            finger.rotation.z = 0.2
        }
    }
    for (const [x, y, z, angle] of [
        [-0.12, -0.15, -0.21, -0.35],
        [0.1, -0.24, 0.21, 0.2],
    ]) {
        const forearm = tube('forearm', x, y, z, 0.054, 0.33, sleeve)
        forearm.rotation.x = 1.1
        forearm.rotation.z = angle
    }
    const muzzle = new TransformNode(prefix + '/socket/muzzle', scene)
    muzzle.parent = root
    muzzle.position.set(0, 0, -0.865)
    const optic = new TransformNode(prefix + '/socket/optic', scene)
    optic.parent = root
    optic.position.set(0, 0.112, -0.24)
    for (const joint of [root, magazine, leftHand])
        batchRigidParts(joint, prefix)
    return { root, muzzle, optic, magazine, leftHand }
}

/** Collapse rigid parts by material without baking the animated joint or camera transform. */
function batchRigidParts(joint: TransformNode, prefix: string): void {
    const parent = joint.parent,
        position = joint.position.clone(),
        rotation = joint.rotation.clone(),
        scale = joint.scaling.clone()
    const groups = new Map<PBRMaterial, Mesh[]>()
    for (const mesh of joint
        .getChildMeshes()
        .filter((m) => m.parent === joint)) {
        const material = mesh.material as PBRMaterial
        if (!groups.has(material)) groups.set(material, [])
        groups.get(material)!.push(mesh as Mesh)
    }
    joint.parent = null
    joint.position.setAll(0)
    joint.rotation.setAll(0)
    joint.scaling.setAll(1)
    joint.computeWorldMatrix(true)
    for (const [material, parts] of groups) {
        if (parts.length < 2) continue
        for (const part of parts) part.computeWorldMatrix(true)
        const merged = Mesh.MergeMeshes(
            parts,
            true,
            true,
            undefined,
            false,
            false
        )
        if (merged) {
            merged.name =
                prefix +
                '/surface/' +
                joint.name.split('/').pop() +
                '/' +
                material.name.split('/').pop()
            merged.parent = joint
            merged.isPickable = false
            merged.renderingGroupId = 1
        }
    }
    joint.parent = parent
    joint.position.copyFrom(position)
    joint.rotation.copyFrom(rotation)
    joint.scaling.copyFrom(scale)
    joint.computeWorldMatrix(true)
}
