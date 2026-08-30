import { Color3 } from '@babylonjs/core/Maths/math.color.js'
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder.js'
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder.js'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js'
import type { Camera } from '@babylonjs/core/Cameras/camera.js'
import type { Scene } from '@babylonjs/core/scene.js'
import { MovementMode, Stance, Weapon, type MovementState, type Vec3 } from '../../protocol/generated'

export type ViewmodelState = 'idle' | 'walk' | 'sprint' | 'crouch' | 'slide' | 'prone' | 'dash' | 'mantle' | 'ads' | 'fire' | 'reload' | 'grenade' | 'melee' | 'hidden'
export const VIEWMODEL_CALIBRATION = { muzzle: { x: .31, y: -.205, z: -1.36 }, optic: { x: .02, y: -.105, z: -.88 } } as const
export function auditViewmodelCalibration(calibration = VIEWMODEL_CALIBRATION): { readonly passed: boolean; readonly muzzleAheadMeters: number; readonly opticCenterErrorMeters: number } { const muzzleAheadMeters = calibration.optic.z - calibration.muzzle.z, opticCenterErrorMeters = Math.abs(calibration.optic.x); return { passed: muzzleAheadMeters >= .4 && muzzleAheadMeters <= .8 && opticCenterErrorMeters <= .04, muzzleAheadMeters, opticCenterErrorMeters } }

interface WeaponRig { readonly root: TransformNode; readonly muzzle: TransformNode; readonly optic: TransformNode }
function meshBox(name: string, parent: TransformNode, dimensions: { width: number; height: number; depth: number }, position: readonly [number, number, number], material: StandardMaterial): void { const mesh = CreateBox(name, dimensions, parent.getScene()); mesh.parent = parent; mesh.position.set(...position); mesh.material = material; mesh.isPickable = false; mesh.renderingGroupId = 1 }
function createRig(name: string, weapon: Weapon, camera: Camera, scene: Scene, metal: StandardMaterial, accent: StandardMaterial, glove: StandardMaterial): WeaponRig {
    const root = new TransformNode(name, scene); root.parent = camera; root.position.set(.32, -.29, -.72)
    meshBox(`${name}/receiver`, root, { width: weapon === Weapon.Shotgun ? .17 : .14, height: .15, depth: .62 }, [0, 0, -.18], metal)
    meshBox(`${name}/stock`, root, { width: .13, height: .19, depth: .32 }, [0, -.015, .29], accent)
    meshBox(`${name}/magazine`, root, { width: .1, height: .27, depth: .15 }, [0, -.19, -.13], accent)
    const barrel = CreateCylinder(`${name}/barrel`, { diameter: weapon === Weapon.Shotgun ? .065 : .04, height: weapon === Weapon.Shotgun ? .76 : .64, tessellation: 10 }, scene); barrel.parent = root; barrel.rotation.x = Math.PI / 2; barrel.position.z = weapon === Weapon.Shotgun ? -.83 : -.76; barrel.material = metal; barrel.isPickable = false; barrel.renderingGroupId = 1
    const leftHand = new TransformNode(`${name}/left-hand-joint`, scene); leftHand.parent = root; leftHand.position.set(-.12, -.17, -.47); leftHand.rotation.z = -.15
    const rightHand = new TransformNode(`${name}/right-hand-joint`, scene); rightHand.parent = root; rightHand.position.set(.14, -.19, -.02); rightHand.rotation.z = .14
    meshBox(`${name}/left-glove`, leftHand, { width: .14, height: .13, depth: .24 }, [0, 0, 0], glove); meshBox(`${name}/right-glove`, rightHand, { width: .14, height: .13, depth: .22 }, [0, 0, 0], glove)
    const muzzle = new TransformNode(`${name}/socket/muzzle`, scene); muzzle.parent = root; muzzle.position.set(VIEWMODEL_CALIBRATION.muzzle.x - .32, VIEWMODEL_CALIBRATION.muzzle.y + .29, VIEWMODEL_CALIBRATION.muzzle.z + .72)
    const optic = new TransformNode(`${name}/socket/optic`, scene); optic.parent = root; optic.position.set(VIEWMODEL_CALIBRATION.optic.x - .32, VIEWMODEL_CALIBRATION.optic.y + .29, VIEWMODEL_CALIBRATION.optic.z + .72)
    return { root, muzzle, optic }
}

/** Original repo-authored articulated hands/weapon rig with calibrated sockets. */
export class ViewmodelController {
    private readonly rigs = new Map<Weapon, WeaponRig>()
    private readonly materials: StandardMaterial[]
    private stateValue: ViewmodelState = 'hidden'
    private stateStartedAtMs = 0
    private weaponValue = Weapon.None
    private rejectionKick = 0
    private readonly muzzleScratch = { x: 0, y: 0, z: 0 }
    constructor(camera: Camera, scene: Scene) {
        const metal = new StandardMaterial('viewmodel/material/metal', scene); metal.diffuseColor = new Color3(.045, .055, .07); metal.specularColor = new Color3(.7, .72, .75)
        const accent = new StandardMaterial('viewmodel/material/accent', scene); accent.diffuseColor = new Color3(.13, .27, .31)
        const glove = new StandardMaterial('viewmodel/material/glove', scene); glove.diffuseColor = new Color3(.11, .13, .15)
        this.materials = [metal, accent, glove]
        this.rigs.set(Weapon.Rifle, createRig('viewmodel/rifle-rig', Weapon.Rifle, camera, scene, metal, accent, glove)); this.rigs.set(Weapon.Shotgun, createRig('viewmodel/shotgun-rig', Weapon.Shotgun, camera, scene, metal, accent, glove))
    }
    setState(state: ViewmodelState, nowMs: number): void { if (state !== this.stateValue) { this.stateValue = state; this.stateStartedAtMs = nowMs } }
    fire(nowMs: number): void { this.stateValue = 'fire'; this.stateStartedAtMs = nowMs }
    rejectAction(): void { this.rejectionKick = 1 }
    update(weapon: Weapon, dead: boolean, reloading: boolean, speed: number, grounded: boolean, nowMs: number, dt: number, movement?: MovementState): void {
        this.weaponValue = weapon
        if (dead || weapon === Weapon.None) this.setState('hidden', nowMs)
        else if (movement?.mode === MovementMode.Mantling) this.setState('mantle', nowMs)
        else if (reloading) this.setState('reload', nowMs)
        else if (movement?.mode === MovementMode.Dashing) this.setState('dash', nowMs)
        else if (movement?.mode === MovementMode.Sliding) this.setState('slide', nowMs)
        else if (movement?.stance === Stance.Prone) this.setState('prone', nowMs)
        else if (movement?.stance === Stance.Crouched) this.setState('crouch', nowMs)
        else if (movement?.mode === MovementMode.Sprinting) this.setState('sprint', nowMs)
        else if (this.stateValue === 'fire' && nowMs - this.stateStartedAtMs < 130) {}
        else this.setState(speed > .15 && grounded ? 'walk' : 'idle', nowMs)
        this.rejectionKick *= Math.exp(-dt * 18)
        for (const [kind, rig] of this.rigs) {
            rig.root.setEnabled(kind === weapon && this.stateValue !== 'hidden')
            if (kind !== weapon) continue
            const elapsed = (nowMs - this.stateStartedAtMs) / 1000
            const walk = this.stateValue === 'walk' || this.stateValue === 'sprint' ? Math.sin(nowMs * .012) : 0
            const fire = this.stateValue === 'fire' ? Math.max(0, 1 - elapsed / .13) : 0
            const reload = this.stateValue === 'reload' ? Math.sin(Math.min(1, elapsed / 1.1) * Math.PI) : 0
            const sprint = this.stateValue === 'sprint' ? 1 : 0, crouch = this.stateValue === 'crouch' ? 1 : 0
            const slide = this.stateValue === 'slide' ? 1 : 0, prone = this.stateValue === 'prone' ? 1 : 0
            const dash = this.stateValue === 'dash' ? Math.exp(-elapsed * 14) : 0, mantle = this.stateValue === 'mantle' ? 1 : 0
            rig.root.position.set(.32 + walk * .012 + sprint * .1, -.29 + Math.abs(walk) * .009 - reload * .08 - sprint * .2 - crouch * .07 - prone * .32 - mantle * .48, -.72 + fire * .11 + this.rejectionKick * .03 + dash * .16)
            rig.root.rotation.set(fire * .075 + reload * .34 + sprint * .42 + mantle * .7, 0, walk * .018 + reload * .18 + slide * .18 + dash * .08)
        }
    }
    muzzlePosition(): Vec3 | undefined { const rig = this.rigs.get(this.weaponValue); if (!rig || !rig.root.isEnabled()) return undefined; const value = rig.muzzle.getAbsolutePosition(); this.muzzleScratch.x = value.x; this.muzzleScratch.y = value.y; this.muzzleScratch.z = value.z; return this.muzzleScratch }
    get state(): ViewmodelState { return this.stateValue }
    dispose(): void { for (const rig of this.rigs.values()) rig.root.dispose(false, true); for (const material of this.materials) material.dispose(); this.rigs.clear() }
}
