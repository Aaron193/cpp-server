import { Entity } from './graphics/Entity'
import { Player } from './graphics/Player'
import { Interpolator } from './Interpolator'
import { Renderer } from './Renderer'
import * as PIXI from 'pixi.js'
export class World {
    renderer: Renderer
    interpolator: Interpolator = new Interpolator(this)
    entities: Map<number, Entity> = new Map()
    // maybe we can rethink these two identifiers... maybe a controlled entity id, and a camera entity id?
    cameraEntityId: number = -1
    active: boolean = false // actively in world vs non active in world, eg: spectator vs player

    private constructor(renderer: Renderer) {
        this.renderer = renderer
    }

    public static async create(): Promise<World> {
        const renderer = await Renderer.create()
        const world = new World(renderer)
        renderer.setWorld(world)
        return world
    }

    update(delta: number, tick: number, now: number) {
        this.interpolator.update(delta, tick, now)

        this.entities.forEach((entity) => {
            entity.update(delta, tick, now)
        })

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
