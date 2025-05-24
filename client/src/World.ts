import { Entity } from './graphics/Entity'
import { Player } from './graphics/Player'
import { Interpolator } from './Interpolator'
import { Renderer } from './Renderer'
import * as PIXI from 'pixi.js'
export class World {
    renderer: Renderer
    interpolator: Interpolator = new Interpolator(this)
    entities: Map<number, Entity> = new Map()
    myEntityId: number = -1

    private constructor(renderer: Renderer) {
        this.renderer = renderer
    }

    public static async create(): Promise<World> {
        const renderer = await Renderer.create()
        return new World(renderer)
    }

    update(delta: number, tick: number, now: number) {
        this.entities.forEach((entity) => {
            entity.update(delta)
        })

        this.interpolator.update(delta, tick, now)

        const myEntity = this.entities.get(this.myEntityId)

        if (myEntity) {
            this.renderer.centerCamera(myEntity.position.x, myEntity.position.y)
        }

        this.renderer.render()
    }
}
