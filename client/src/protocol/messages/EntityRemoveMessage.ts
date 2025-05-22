import { GameClient } from '../../GameClient'
import { assert } from '../../utils/assert'
import { IMessage } from './IMessage'

export class EntityRemoveMessage implements IMessage {
    constructor(private entityIds: number[]) {}

    process(client: GameClient): void {
        console.log(
            `Processing entity remove for ${this.entityIds.length} entities`
        )

        for (const id of this.entityIds) {
            const entity = client.world.entities.get(id)!
            assert(entity != undefined, `Entity with ID: ${id} not found`)

            entity.destroy()
            client.world.entities.delete(id)
        }
    }
}
