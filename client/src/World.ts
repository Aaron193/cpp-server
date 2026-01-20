import { Bullet } from './graphics/Bullet'
import { Entity } from './graphics/Entity'
import { ItemType } from './enums/ItemType'
import { Interpolator } from './Interpolator'
import { Renderer } from './Renderer'

export type InventorySlotState = {
    type: ItemType
    fireMode: number
    ammoType: number
    magazineSize: number
    ammoInMag: number
    reloadRemaining: number
}

export type WorldEffect = {
    update(delta: number, tick: number, now: number): void
    destroyed?: boolean
}

export class World {
    renderer: Renderer
    interpolator: Interpolator = new Interpolator(this)
    entities: Map<number, Entity> = new Map()
    projectiles: Map<number, Bullet> = new Map()
    pendingProjectileDestroys: Set<number> = new Set()
    lastKnownServerTick: number = 0
    // maybe we can rethink these two identifiers... maybe a controlled entity id, and a camera entity id?
    cameraEntityId: number = -1
    active: boolean = false // actively in world vs non active in world, eg: spectator vs player

    inventorySlots: InventorySlotState[] = Array.from({ length: 5 }, () => ({
        type: ItemType.ITEM_NONE,
        fireMode: 0,
        ammoType: 0,
        magazineSize: 0,
        ammoInMag: 0,
        reloadRemaining: 0,
    }))
    activeSlot: number = 0
    activeAmmoInMag: number = 0
    activeAmmoReserve: number = 0
    activeReloadRemaining: number = 0

    private effects: WorldEffect[] = []

    private constructor(renderer: Renderer) {
        this.renderer = renderer
    }

    public static async create(): Promise<World> {
        const renderer = await Renderer.create()
        const world = new World(renderer)
        renderer.setWorld(world)
        return world
    }

    isControllingPlayer() {
        return this.active && this.entities.has(this.cameraEntityId)
    }

    addEffect(effect: WorldEffect) {
        this.effects.push(effect)
    }

    addProjectile(projectile: Bullet) {
        this.projectiles.set(projectile._id, projectile)
    }

    removeProjectile(id: number) {
        const projectile = this.projectiles.get(id)
        if (!projectile) {
            this.pendingProjectileDestroys.add(id)
            return
        }

        projectile.destroy()
        this.projectiles.delete(id)
    }

    update(delta: number, tick: number, now: number) {
        this.interpolator.update(delta, tick, now)

        this.entities.forEach((entity) => {
            entity.update(delta, tick, now)
        })

        this.projectiles.forEach((projectile) => {
            projectile.update(delta, tick, now)
        })

        this.effects.forEach((effect) => effect.update(delta, tick, now))
        this.effects = this.effects.filter((effect) => !effect.destroyed)

        const cameraEntity = this.entities.get(this.cameraEntityId)

        if (cameraEntity) {
            this.renderer.centerCamera(
                cameraEntity.position.x,
                cameraEntity.position.y
            )
        }

        this.renderer.update(delta, tick, now)
        this.renderer.render()
    }
}
