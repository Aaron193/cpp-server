import { GameClient } from '../../GameClient'
import { assert } from '../../utils/assert'
import { IMessage } from './IMessage'

export class EntityUpdateMessage implements IMessage {
    constructor(
        private entities: Array<{
            id: number
            x: number
            y: number
            angle: number
        }>
    ) {}

    process(client: GameClient): void {
        console.log(
            `Processing entity update for ${this.entities.length} entities`
        )

        for (const entity of this.entities) {
            const player = client.world.entities.get(entity.id)!
            assert(
                player != undefined,
                `Entity with ID: ${entity.id} not found`
            )

            player.position.x = entity.x
            player.position.y = entity.y
            player.angle = entity.angle
        }
    }
}
