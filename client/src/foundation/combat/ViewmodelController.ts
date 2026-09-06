import { buildWeaponModel, type WeaponRig } from './WeaponModel'
import { INFANTRY_WEAPONS } from './WeaponDefinitions'
import type { Camera } from '@babylonjs/core/Cameras/camera.js'
import type { Scene } from '@babylonjs/core/scene.js'
import {
    MovementMode,
    Stance,
    Weapon,
    type MovementState,
    type Vec3,
} from '../../protocol/generated'

export type ViewmodelState =
    | 'idle'
    | 'walk'
    | 'sprint'
    | 'crouch'
    | 'slide'
    | 'prone'
    | 'dash'
    | 'mantle'
    | 'ads'
    | 'fire'
    | 'reload'
    | 'grenade'
    | 'melee'
    | 'hidden'
export const VIEWMODEL_CALIBRATION = {
    muzzle: { x: 0, y: -0.112, z: -1.305 },
    optic: { x: 0, y: 0, z: -0.68 },
} as const
export function auditViewmodelCalibration(
    calibration = VIEWMODEL_CALIBRATION
): {
    readonly passed: boolean
    readonly muzzleAheadMeters: number
    readonly opticCenterErrorMeters: number
} {
    const muzzleAheadMeters = calibration.optic.z - calibration.muzzle.z,
        opticCenterErrorMeters = Math.abs(calibration.optic.x)
    return {
        passed:
            muzzleAheadMeters >= 0.4 &&
            muzzleAheadMeters <= 0.8 &&
            opticCenterErrorMeters <= 0.04,
        muzzleAheadMeters,
        opticCenterErrorMeters,
    }
}

/** Original repo-authored articulated hands/weapon rig with calibrated sockets. */
export class ViewmodelController {
    private readonly rigs = new Map<Weapon, WeaponRig>()
    private stateValue: ViewmodelState = 'hidden'
    private stateStartedAtMs = 0
    private weaponValue = Weapon.None
    private rejectionKick = 0
    private equipAt = 0
    private sprintBlend = 0
    private clearanceBlend = 0
    private readonly muzzleScratch = { x: 0, y: 0, z: 0 }
    constructor(camera: Camera, scene: Scene) {
        this.rigs.set(
            Weapon.Rifle,
            buildWeaponModel(Weapon.Rifle, camera, scene)
        )
        this.rigs.set(
            Weapon.Shotgun,
            buildWeaponModel(Weapon.Shotgun, camera, scene)
        )
    }
    setState(state: ViewmodelState, nowMs: number): void {
        if (state !== this.stateValue) {
            this.stateValue = state
            this.stateStartedAtMs = nowMs
        }
    }
    fire(nowMs: number): void {
        this.stateValue = 'fire'
        this.stateStartedAtMs = nowMs
    }
    rejectAction(): void {
        this.rejectionKick = 1
    }
    update(
        weapon: Weapon,
        dead: boolean,
        reloading: boolean,
        speed: number,
        grounded: boolean,
        nowMs: number,
        dt: number,
        movement?: MovementState,
        aimProgress = 0,
        reloadDuration = INFANTRY_WEAPONS[
            weapon === Weapon.Shotgun ? Weapon.Shotgun : Weapon.Rifle
        ].reloadTime,
        wallTuck = 0
    ): void {
        if (this.weaponValue !== weapon) this.equipAt = nowMs
        this.weaponValue = weapon
        this.clearanceBlend +=
            (wallTuck - this.clearanceBlend) * (1 - Math.exp(-dt * 16))
        if (dead || weapon === Weapon.None) this.setState('hidden', nowMs)
        else if (movement?.mode === MovementMode.Mantling)
            this.setState('mantle', nowMs)
        else if (reloading) this.setState('reload', nowMs)
        else if (movement?.mode === MovementMode.Dashing)
            this.setState('dash', nowMs)
        else if (movement?.mode === MovementMode.Sliding)
            this.setState('slide', nowMs)
        else if (movement?.stance === Stance.Prone)
            this.setState('prone', nowMs)
        else if (movement?.stance === Stance.Crouched)
            this.setState('crouch', nowMs)
        else if (movement?.mode === MovementMode.Sprinting)
            this.setState('sprint', nowMs)
        else if (
            this.stateValue === 'fire' &&
            nowMs - this.stateStartedAtMs < 130
        ) {
        } else if (aimProgress > 0.01) this.setState('ads', nowMs)
        else this.setState(speed > 0.15 && grounded ? 'walk' : 'idle', nowMs)
        this.rejectionKick *= Math.exp(-dt * 18)
        for (const [kind, rig] of this.rigs) {
            rig.root.setEnabled(kind === weapon && this.stateValue !== 'hidden')
            if (kind !== weapon) continue
            const elapsed = (nowMs - this.stateStartedAtMs) / 1000
            const walk =
                this.stateValue === 'walk' || this.stateValue === 'sprint'
                    ? Math.sin(nowMs * 0.012)
                    : 0
            const fire =
                this.stateValue === 'fire' ? Math.max(0, 1 - elapsed / 0.13) : 0
            const reloadProgress =
                this.stateValue === 'reload'
                    ? Math.min(1, elapsed / Math.max(0.01, reloadDuration))
                    : 0
            const reload = Math.sin(reloadProgress * Math.PI)
            const sprint = this.stateValue === 'sprint' ? 1 : 0,
                crouch = this.stateValue === 'crouch' ? 1 : 0
            const slide = this.stateValue === 'slide' ? 1 : 0,
                prone = this.stateValue === 'prone' ? 1 : 0
            const dash =
                    this.stateValue === 'dash' ? Math.exp(-elapsed * 14) : 0,
                mantle = this.stateValue === 'mantle' ? 1 : 0
            const ads = Math.max(0, Math.min(1, aimProgress))
            const breathing = Math.sin(nowMs * 0.0017) * 0.0015 * ads
            this.sprintBlend +=
                (sprint - this.sprintBlend) * (1 - Math.exp(-dt * 12))
            const equip = Math.max(0, 1 - (nowMs - this.equipAt) / 350)
            const targetX =
                0.235 * (1 - ads) +
                walk * 0.006 * (1 - ads) +
                this.sprintBlend * 0.08
            const targetY =
                -0.24 * (1 - ads) -
                0.112 * ads -
                reload * 0.1 -
                this.sprintBlend * 0.14 -
                mantle * 0.35 -
                equip * 0.3 +
                breathing
            const targetZ =
                -0.44 +
                fire * 0.055 +
                this.rejectionKick * 0.02 +
                this.clearanceBlend * 0.5
            rig.root.position.set(
                targetX,
                targetY - this.clearanceBlend * 0.12,
                targetZ
            )
            rig.root.rotation.set(
                fire * 0.035 +
                    reload * 0.24 +
                    this.sprintBlend * 0.3 +
                    equip * 0.3,
                reload * -0.15 + this.clearanceBlend * 0.3,
                walk * 0.007 * (1 - ads) +
                    reload * 0.28 +
                    this.sprintBlend * 0.12
            )
            rig.magazine.position.y =
                -0.095 - Math.sin(reloadProgress * Math.PI) * 0.26
            rig.magazine.rotation.z = Math.sin(reloadProgress * Math.PI) * -0.35
            rig.leftHand.position.y =
                -0.065 - Math.sin(reloadProgress * Math.PI) * 0.17
        }
    }
    muzzlePosition(): Vec3 | undefined {
        const rig = this.rigs.get(this.weaponValue)
        if (!rig || !rig.root.isEnabled()) return undefined
        const value = rig.muzzle.getAbsolutePosition()
        this.muzzleScratch.x = value.x
        this.muzzleScratch.y = value.y
        this.muzzleScratch.z = value.z
        return this.muzzleScratch
    }
    get state(): ViewmodelState {
        return this.stateValue
    }
    dispose(): void {
        for (const rig of this.rigs.values()) rig.root.dispose(false, true)
        this.rigs.clear()
    }
}
