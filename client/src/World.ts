import { Player } from './graphics/Player'
import { Renderer } from './Renderer'

export class World {
    renderer: Renderer
    entities: Map<number, Player> = new Map()
    myEntityId: number = -1

    private constructor(renderer: Renderer) {
        this.renderer = renderer
    }

    public static async create(): Promise<World> {
        const renderer = await Renderer.create()
        return new World(renderer)
    }

    update(delta: number) {
        this.entities.forEach((player) => {
            player.update(delta)
        })

        const myEntity = this.entities.get(this.myEntityId)

        if (myEntity) {
            this.renderer.centerCamera(myEntity.position.x, myEntity.position.y)
        }

        this.renderer.render()
    }
}
