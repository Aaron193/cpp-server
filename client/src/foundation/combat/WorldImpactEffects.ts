import { Vector3 } from '@babylonjs/core/Maths/math.vector.js'
import { Color3 } from '@babylonjs/core/Maths/math.color.js'
import { Ray } from '@babylonjs/core/Culling/ray.js'
import { PointLight } from '@babylonjs/core/Lights/pointLight.js'
import { CreateDecal } from '@babylonjs/core/Meshes/Builders/decalBuilder.js'
import type { Mesh } from '@babylonjs/core/Meshes/mesh.js'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js'
import type { Scene } from '@babylonjs/core/scene.js'
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js'
import type { Vec3 } from '../../protocol/generated'
import { BoundedEffectFamily, type EffectSlot } from './BoundedEffects'
import {
    createRibbon,
    effectBillboard,
    effectMaterial,
    positionRibbon,
    type Ribbon,
} from './CombatEffectVisuals'

export const BULLET_HOLE_LIFETIME_MS = 45000
export const BULLET_HOLE_FADE_MS = 5000
export const BULLET_HOLE_CAPACITY = 512

interface Particle extends EffectSlot {
    mesh: Mesh
    origin: Vector3
    velocity: Vector3
    duration: number
    size: number
    growth: number
    gravity: number
    opacity: number
}
interface Flash extends EffectSlot {
    mesh: Mesh
    jet: Ribbon
    origin: Vector3
    direction: Vector3
    local: boolean
    actionId: number
    size: number
}
interface Light extends EffectSlot {
    light: PointLight
    duration: number
}
interface Decal {
    mesh: Mesh
    createdAt: number
}

/** Presentation meshes must never become targets for impact projection or offline shots. */
export function isWorldSurface(mesh: AbstractMesh): boolean {
    return (
        mesh.isEnabled() &&
        mesh.isVisible &&
        (mesh.isPickable || mesh.name.startsWith('map/')) &&
        !mesh.name.includes('render-grass') &&
        mesh.getTotalVertices() > 0 &&
        !/^(viewmodel\/|remote-|tracer\/|muzzle\/|impact\/|decal\/|effects\/)/.test(
            mesh.name
        )
    )
}

export class WorldImpactEffects {
    private readonly materials: Record<
        'flash' | 'smoke' | 'spark' | 'blood' | 'hole' | 'tracer',
        StandardMaterial
    >
    private readonly particles: BoundedEffectFamily<Particle>
    private readonly flashes: BoundedEffectFamily<Flash>
    private readonly lights: BoundedEffectFamily<Light>
    private readonly decals: Decal[] = []
    private readonly head = new Vector3()
    private serial = 0
    constructor(private readonly scene: Scene) {
        this.materials = Object.fromEntries(
            (
                ['flash', 'smoke', 'spark', 'blood', 'hole', 'tracer'] as const
            ).map((kind) => [kind, effectMaterial(scene, kind)])
        ) as typeof this.materials
        this.particles = new BoundedEffectFamily(
            96,
            (index) => ({
                mesh: effectBillboard(
                    `impact/${index}`,
                    scene,
                    this.materials.smoke
                ),
                origin: new Vector3(),
                velocity: new Vector3(),
                startedAtMs: 0,
                priority: 0,
                duration: 0,
                size: 0,
                growth: 0,
                gravity: 0,
                opacity: 0,
            }),
            (slot) => slot.mesh.setEnabled(false)
        )
        this.flashes = new BoundedEffectFamily<Flash>(
            16,
            (index) => ({
                mesh: effectBillboard(
                    `muzzle/${index}`,
                    scene,
                    this.materials.flash
                ),
                jet: createRibbon(
                    `muzzle/${index}/jet`,
                    scene,
                    this.materials.tracer
                ),
                origin: new Vector3(),
                direction: new Vector3(),
                local: false,
                actionId: 0,
                size: 0,
                startedAtMs: 0,
                priority: 0,
            }),
            (slot) => {
                slot.mesh.setEnabled(false)
                slot.jet.mesh.setEnabled(false)
            }
        )
        this.lights = new BoundedEffectFamily(
            3,
            (index) => {
                const light = new PointLight(
                    `effects/light/${index}`,
                    Vector3.Zero(),
                    scene
                )
                light.diffuse = new Color3(1, 0.62, 0.3)
                light.range = 3.5
                light.intensity = 0
                return { light, startedAtMs: 0, priority: 0, duration: 55 }
            },
            (slot) => {
                slot.light.intensity = 0
            }
        )
    }
    async prepare(): Promise<void> {
        let flash: Flash | undefined, particle: Particle | undefined
        this.flashes.forEach((slot) => {
            flash ??= slot
        })
        this.particles.forEach((slot) => {
            particle ??= slot
        })
        if (!flash || !particle) return
        await Promise.all([
            this.materials.flash.forceCompilationAsync(flash.mesh),
            this.materials.tracer.forceCompilationAsync(flash.jet.mesh),
            ...(['smoke', 'spark', 'blood', 'hole'] as const).map((kind) =>
                this.materials[kind].forceCompilationAsync(particle!.mesh)
            ),
        ])
    }
    flash(
        position: Vec3,
        direction: Vec3,
        now: number,
        actionId: number,
        local: boolean,
        shotgun: boolean
    ): void {
        const slot = this.flashes.acquire(now, local ? 3 : 2)
        slot.origin.copyFromFloats(position.x, position.y, position.z)
        slot.direction
            .copyFromFloats(direction.x, direction.y, direction.z)
            .normalize()
        slot.local = local
        slot.actionId = actionId
        slot.size = (shotgun ? 0.42 : 0.27) * (0.85 + (actionId % 7) * 0.05)
        slot.mesh.rotation.z = actionId * 2.39996
        // Viewmodel group is deliberately separate; world flashes retain world depth.
        slot.mesh.renderingGroupId = slot.jet.mesh.renderingGroupId = local
            ? 1
            : 0
        slot.mesh.setEnabled(true)
        slot.jet.mesh.setEnabled(true)
        const light = this.lights.acquire(now, local ? 3 : 1)
        light.light.position.copyFrom(slot.origin)
        light.light.intensity = local ? 1.8 : 1.2
        this.particle(
            position,
            new Vector3(
                slot.direction.x * 0.55,
                slot.direction.y * 0.55 + 0.2,
                slot.direction.z * 0.55
            ),
            'smoke',
            now,
            320,
            0.09,
            0.35,
            0,
            0.15
        )
    }
    reject(actionId: number): void {
        this.flashes.releaseWhere(
            (slot) => slot.local && slot.actionId === actionId
        )
    }
    impact(position: Vec3, normal: Vec3, player: boolean, now: number): void {
        const n = new Vector3(normal.x, normal.y, normal.z).normalize()
        if (n.lengthSquared() < 0.5) n.set(0, 1, 0)
        const center = new Vector3(
            position.x,
            position.y,
            position.z
        ).addInPlace(n.scale(0.025))
        this.particle(
            center,
            n.scale(player ? 0.45 : 0.8),
            player ? 'blood' : 'smoke',
            now,
            player ? 230 : 520,
            player ? 0.16 : 0.12,
            player ? 0.5 : 1.15,
            0.5,
            player ? 0.55 : 0.5
        )
        // Small, brief hot fragments; the lasting mark is a dark recess, not an orange orb.
        for (let i = 0; i < (player ? 2 : 4); i++) {
            const seed = ++this.serial * 2.39996
            const tangent = new Vector3(
                Math.sin(seed),
                Math.cos(seed * 1.7),
                Math.sin(seed * 0.7)
            )
            if (Vector3.Dot(tangent, n) < 0) tangent.scaleInPlace(-1)
            tangent
                .addInPlace(n)
                .normalize()
                .scaleInPlace(player ? 0.7 : 1.6 + (i % 3) * 0.7)
            this.particle(
                center,
                tangent,
                player ? 'blood' : 'spark',
                now,
                100 + i * 35,
                player ? 0.05 : 0.027,
                0,
                4.5,
                0.85
            )
        }
        if (!player) this.addDecal(position, n, now)
    }
    private particle(
        origin: Vec3,
        velocity: Vector3,
        kind: 'smoke' | 'spark' | 'blood',
        now: number,
        duration: number,
        size: number,
        growth: number,
        gravity: number,
        opacity: number
    ): void {
        const slot = this.particles.acquire(now, kind === 'smoke' ? 1 : 2)
        slot.origin.copyFromFloats(origin.x, origin.y, origin.z)
        slot.velocity.copyFrom(velocity)
        slot.mesh.material = this.materials[kind]
        slot.mesh.rotation.z = ++this.serial * 2.39996
        slot.duration = duration
        slot.size = size
        slot.growth = growth
        slot.gravity = gravity
        slot.opacity = opacity
        slot.mesh.setEnabled(true)
    }
    private addDecal(position: Vec3, normal: Vector3, now: number): void {
        const point = new Vector3(position.x, position.y, position.z)
        // Project onto the render surface, clipped to its triangles (including edges and curved props).
        const pick = this.scene.pickWithRay(
            new Ray(point.add(normal.scale(0.18)), normal.negate(), 0.4),
            isWorldSurface
        )
        if (!pick?.hit || !pick.pickedMesh || !pick.pickedPoint) return
        this.expireDecals(now)
        // Preserve every admitted hole's lifetime. At the emergency global cap,
        // skip a new mark rather than visibly erasing an existing one.
        if (this.decals.length >= BULLET_HOLE_CAPACITY) return
        const size = 0.11 + (this.serial % 5) * 0.009
        const mesh = CreateDecal(
            `decal/bullet/${++this.serial}`,
            pick.pickedMesh,
            {
                position: pick.pickedPoint,
                normal: pick.getNormal(true) ?? normal,
                size: new Vector3(size, size, 0.12),
                angle: this.serial * 2.39996,
                cullBackFaces: true,
            }
        )
        mesh.material = this.materials.hole
        mesh.isPickable = false
        this.decals.push({ mesh, createdAt: now })
    }
    private removeDecal(decal: Decal): void {
        decal.mesh.dispose()
        this.decals.splice(this.decals.indexOf(decal), 1)
    }
    update(now: number, eye: Vector3, localMuzzle?: Vec3): void {
        this.flashes.forEachActive((slot) => {
            const age = now - slot.startedAtMs
            if (age >= 58) {
                this.flashes.release(slot)
                return
            }
            if (slot.local && localMuzzle)
                slot.origin.copyFromFloats(
                    localMuzzle.x,
                    localMuzzle.y,
                    localMuzzle.z
                )
            const fade = Math.pow(1 - age / 58, 1.6)
            slot.mesh.position.copyFrom(slot.origin)
            slot.mesh.scaling.setAll(slot.size * (0.7 + age / 100))
            slot.mesh.visibility = fade
            slot.origin.addToRef(
                slot.direction.scaleToRef(slot.size * 1.8, this.head),
                this.head
            )
            positionRibbon(
                slot.jet,
                slot.origin,
                this.head,
                eye,
                slot.size * 0.5
            )
            slot.jet.mesh.visibility = fade * 0.8
        })
        this.particles.forEachActive((slot) => {
            const age = now - slot.startedAtMs,
                t = age / 1000,
                life = age / slot.duration
            if (life >= 1) {
                this.particles.release(slot)
                return
            }
            slot.mesh.position
                .copyFrom(slot.origin)
                .addInPlace(slot.velocity.scaleToRef(t, this.head))
            slot.mesh.position.y -= slot.gravity * t * t * 0.5
            slot.mesh.scaling.setAll(slot.size + slot.growth * t)
            slot.mesh.visibility = slot.opacity * Math.pow(1 - life, 1.4)
        })
        this.lights.forEachActive((slot) => {
            const life = (now - slot.startedAtMs) / slot.duration
            if (life >= 1) this.lights.release(slot)
            else slot.light.intensity = 1.8 * Math.pow(1 - life, 2)
        })
        this.expireDecals(now)
    }
    private expireDecals(now: number): void {
        for (let i = this.decals.length - 1; i >= 0; i--) {
            const decal = this.decals[i]!,
                age = now - decal.createdAt
            if (age >= BULLET_HOLE_LIFETIME_MS) this.removeDecal(decal)
            else
                decal.mesh.visibility = Math.min(
                    1,
                    (BULLET_HOLE_LIFETIME_MS - age) / BULLET_HOLE_FADE_MS
                )
        }
    }
    clear(): void {
        this.flashes.releaseWhere(() => true)
        this.particles.releaseWhere(() => true)
        this.lights.releaseWhere(() => true)
        for (const decal of [...this.decals]) this.removeDecal(decal)
    }
    get telemetry() {
        const families = [
            this.flashes.telemetry,
            this.particles.telemetry,
            this.lights.telemetry,
        ]
        return {
            active: families.reduce((n, f) => n + f.active, this.decals.length),
            capacity: families.reduce(
                (n, f) => n + f.capacity,
                BULLET_HOLE_CAPACITY
            ),
            replacements: families.reduce((n, f) => n + f.replacements, 0),
        }
    }
    dispose(): void {
        this.clear()
        this.flashes.forEach((slot) => {
            slot.mesh.dispose()
            slot.jet.mesh.dispose()
        })
        this.particles.forEach((slot) => slot.mesh.dispose())
        this.lights.forEach((slot) => slot.light.dispose())
        for (const material of Object.values(this.materials))
            material.dispose(false, true)
    }
}
