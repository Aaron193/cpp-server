import { Player } from '../../graphics/Player'
import { GameClient } from '../../GameClient'
import { IMessage } from './IMessage'

export class EntityCreateMessage implements IMessage {
    constructor(
        private entities: Array<{
            id: number
            type: number
            x: number
            y: number
            angle: number
        }>
    ) {}

    process(client: GameClient): void {
        console.log(
            `Processing entity create for ${this.entities.length} entities`
        )

        for (const entity of this.entities) {
            const player = new Player(client)
            player.position.x = entity.x
            player.position.y = entity.y
            player.angle = entity.angle
            player.id = entity.id
            player.type = entity.type
            player.name = `Player ${entity.id}`

            client.world.entities.set(entity.id, player)
        }
    }
}
