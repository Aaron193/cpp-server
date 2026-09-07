import { Engine } from '@babylonjs/core/Engines/engine.js'
import { Scene } from '@babylonjs/core/scene.js'
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js'
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js'
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector.js'
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.js'
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder.js'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js'
import { CombatPresentationModule } from '../../src/foundation/combat/CombatPresentationModule'
import { CombatPresentationState } from '../../src/foundation/combat/CombatState'
import { INFANTRY_WEAPONS } from '../../src/foundation/combat/WeaponDefinitions'
import {
    createRibbon,
    effectMaterial,
    positionRibbon,
} from '../../src/foundation/combat/CombatEffectVisuals'
import { HudModule } from '../../src/foundation/hud/HudModule'
import { SimulationAim } from '../../src/foundation/camera/SimulationAim'
import {
    ServiceRegistry,
    type ServiceToken,
} from '../../src/foundation/lifecycle'
import {
    AIMING,
    ARENA,
    AUDIO,
    CAMERA,
    CAMERA_RIG,
    ENTITY_VIEWS,
    INPUT,
    KILLCAM,
    NETWORKING,
    PHYSICS,
    SCENE,
    SIMULATION_AIM,
} from '../../src/foundation/services'
import { ImpactMaterial, Weapon } from '../../src/protocol/generated'

/** Deterministic browser fixture exercising the production renderer and HUD. No game runtime hooks. */
export async function mountCombatScene() {
    const canvas = document.createElement('canvas'),
        root = document.createElement('div')
    canvas.style.cssText =
        'position:fixed;inset:0;width:100vw;height:100vh;outline:0'
    root.style.cssText =
        'position:fixed;inset:0;z-index:1;isolation:isolate;pointer-events:none'
    document.body.replaceChildren(canvas, root)
    const engine = new Engine(canvas, true, { preserveDrawingBuffer: true })
    const scene = new Scene(engine)
    scene.useRightHandedSystem = true
    scene.clearColor = new Color4(0.17, 0.22, 0.26, 1)
    const camera = new FreeCamera('camera', new Vector3(0, 1.6, 0), scene)
    camera.setTarget(new Vector3(0, 1.6, -8))
    camera.minZ = 0.05
    const light = new HemisphericLight('light', new Vector3(0.2, 1, 0.4), scene)
    light.intensity = 1.2
    const wall = CreateBox(
        'map/concrete',
        { width: 8, height: 5, depth: 0.5 },
        scene
    )
    wall.position.set(0, 1, -6)
    wall.isPickable = false
    wall.computeWorldMatrix(true)
    const material = new StandardMaterial('concrete', scene)
    material.diffuseColor = new Color3(0.48, 0.49, 0.45)
    material.specularColor.setAll(0)
    wall.material = material
    const floor = CreateBox(
        'map/floor',
        { width: 40, height: 0.2, depth: 40 },
        scene
    )
    floor.position.y = -0.1
    floor.material = material
    floor.computeWorldMatrix(true)
    const services = new ServiceRegistry(),
        combat = new CombatPresentationState(),
        aim = new SimulationAim()
    combat.initializeOffline()
    const provide = <T>(token: ServiceToken<T>, value: unknown) =>
        services.provide(token, value as T)
    provide(SCENE, scene)
    provide(CAMERA, camera)
    provide(SIMULATION_AIM, aim)
    provide(NETWORKING, {
        combat,
        status: 'connected',
        tickRate: 60,
        serverTickNow: undefined,
        latestTick: 100,
        weaponDefinitions: INFANTRY_WEAPONS,
        metrics: new Proxy({}, { get: () => 0 }),
        forEachCorrection: () => {},
        matchCountdownSeconds: () => 0,
    })
    provide(PHYSICS, {
        position: Vector3.Zero(),
        velocity: Vector3.Zero(),
        probeStatic: () => undefined,
        grounded: true,
        movementState: { dashCooldownRemaining: 0 },
        tuning: { dashCooldown: 1 },
    })
    provide(AIMING, {
        snapshot: {
            aimProgress: 0,
            spreadRadians: 0.01,
            bloomRadians: 0,
            recoilPitch: 0,
            recoilYaw: 0,
            reticleMinGapPx: 6,
            reticleArmLengthPx: 6,
        },
    })
    provide(CAMERA_RIG, { addRecoil: () => {}, addDamage: () => {} })
    provide(AUDIO, {
        playWeapon: () => {},
        playImpact: () => {},
        playUi: () => {},
    })
    provide(ENTITY_VIEWS, {
        getSocket: () => undefined,
        get: () => ({ position: new Vector3(5, 1.6, -8) }),
        triggerOneShot: () => {},
    })
    provide(ARENA, { isDebugVisible: false, mapManifest: undefined })
    provide(INPUT, { hasPointerLock: true, showScoreboard: false })
    provide(KILLCAM, { state: 'live' })
    const context = { canvas, hudRoot: root, services },
        presentation = new CombatPresentationModule(),
        hud = new HudModule()
    presentation.initialize(context)
    hud.initialize(context)
    let now = 1000
    Object.defineProperty(performance, 'now', {
        configurable: true,
        value: () => now,
    })
    async function step(at: number) {
        const frame = {
            deltaSeconds: Math.max(1 / 144, (at - now) / 1000),
            elapsedSeconds: at / 1000,
            frame: 1,
        }
        now = at
        presentation.update(frame)
        hud.update(frame)
        scene.render()
        await scene.whenReadyAsync()
        scene.render()
    }
    await presentation.start()
    await step(1000)
    return {
        step,
        shoot: () => combat.localFire(1, 1, Weapon.Rifle, now),
        incoming: () =>
            combat.shot({
                serverTick: 100,
                shooterId: 2,
                inputSequence: 1,
                actionId: 5,
                shotId: 10,
                weapon: Weapon.Rifle,
                origin: { x: -15, y: 2.5, z: -3 },
                pelletEndPositions: [{ x: 405, y: 2.5, z: -3 }],
            }),
        impact: () =>
            combat.impact({
                serverTick: 101,
                shotId: 99,
                pelletIndex: 0,
                position: { x: 0.7, y: 1.6, z: -5.75 },
                normal: { x: 0, y: 0, z: 1 },
                material: ImpactMaterial.World,
            }),
        hit: (targetId = 2, amount = 28) =>
            combat.damage({
                serverTick: 100,
                sourceId: 1,
                targetId,
                amount,
                remainingHealth: 72,
            }),
        hurt: () => {
            combat.damage({
                serverTick: 100,
                sourceId: 2,
                targetId: 1,
                amount: 28,
                remainingHealth: 18,
            })
            hud.showDirectionalDamage(Math.PI / 3, 28)
        },
        health: (health: number) => {
            combat.acceptAuthoritative(
                {
                    health,
                    stateFlags: 0,
                    weaponState: {
                        selected: Weapon.Rifle,
                        magazineAmmo: 30,
                        reserveAmmo: 120,
                        stateFlags: 0,
                    },
                } as Parameters<typeof combat.acceptAuthoritative>[0],
                null
            )
        },
        turn: (yaw: number) => aim.set(yaw, 0),
        kill: () =>
            combat.death({
                serverTick: 100,
                killerId: 1,
                victimId: 2,
                weapon: Weapon.Rifle,
            }),
        depthProof: async () => {
            const material = effectMaterial(scene, 'tracer'),
                ribbon = createRibbon('tracer/depth-probe', scene, material)
            const point = Vector3.Project(
                new Vector3(0, 2.3, -8),
                Matrix.IdentityReadOnly,
                scene.getTransformMatrix(),
                camera.viewport.toGlobal(
                    engine.getRenderWidth(),
                    engine.getRenderHeight()
                )
            )
            const pixel = async () => {
                scene.render()
                const data = await engine.readPixels(
                    Math.floor(point.x),
                    engine.getRenderHeight() - Math.floor(point.y),
                    1,
                    1
                )
                return Array.from(
                    new Uint8Array(
                        data.buffer,
                        data.byteOffset,
                        data.byteLength
                    )
                ).slice(0, 3)
            }
            const baseline = await pixel()
            positionRibbon(
                ribbon,
                new Vector3(-1, 2.3, -8),
                new Vector3(1, 2.3, -8),
                camera.globalPosition,
                0.18
            )
            ribbon.mesh.setEnabled(true)
            scene.render()
            await scene.whenReadyAsync()
            const behind = await pixel()
            positionRibbon(
                ribbon,
                new Vector3(-0.5, 1.95, -4),
                new Vector3(0.5, 1.95, -4),
                camera.globalPosition,
                0.18
            )
            const front = await pixel()
            ribbon.mesh.dispose()
            material.dispose(false, true)
            return {
                hiddenDelta: Math.max(
                    ...baseline.map((n, i) => Math.abs(n - behind[i]!))
                ),
                visibleDelta: Math.max(
                    ...baseline.map((n, i) => Math.abs(n - front[i]!))
                ),
            }
        },
        skyProof: async () => {
            await step(4000)
            wall.setEnabled(false)
            scene.clearColor = new Color4(0.68, 0.78, 0.9, 1)
            scene.fogMode = Scene.FOGMODE_EXP2
            scene.fogDensity = 0.0025
            const sample = async () => {
                scene.render()
                const data = await engine.readPixels(
                    0,
                    Math.floor(engine.getRenderHeight() / 2),
                    engine.getRenderWidth(),
                    Math.floor(engine.getRenderHeight() / 2)
                )
                return new Uint8Array(
                    data.buffer,
                    data.byteOffset,
                    data.byteLength
                ).slice()
            }
            const baseline = await sample()
            // Delayed, sideways gunfire at 120 m with no impact or damage event.
            Object.assign(services.get(NETWORKING), { serverTickNow: 160 })
            combat.shot({
                serverTick: 100,
                shooterId: 2,
                inputSequence: 99,
                actionId: 99,
                shotId: 99,
                weapon: Weapon.Rifle,
                origin: { x: -30, y: 20, z: -120 },
                pelletEndPositions: [{ x: 390, y: 20, z: -120 }],
            })
            await step(4000)
            const after = await sample()
            let changedPixels = 0
            for (let i = 0; i < after.length; i += 4)
                if (
                    Math.max(
                        Math.abs(after[i]! - baseline[i]!),
                        Math.abs(after[i + 1]! - baseline[i + 1]!),
                        Math.abs(after[i + 2]! - baseline[i + 2]!)
                    ) > 12
                )
                    changedPixels++
            return changedPixels
        },
        facts: () => ({
            decals: scene.meshes
                .filter((m) => m.name.startsWith('decal/'))
                .map((m) => ({
                    vertices: m.getTotalVertices(),
                    material: m.material?.name,
                })),
            tracers: scene.meshes
                .filter(
                    (m) =>
                        m.name.startsWith('tracer/') &&
                        !m.name.endsWith('/tip') &&
                        m.isEnabled()
                )
                .map((m) => ({ x: m.position.x, group: m.renderingGroupId })),
            effects: presentation.effectPoolUtilization,
        }),
    }
}
