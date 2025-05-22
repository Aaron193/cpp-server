import { GameClient } from '../../GameClient'
import { IMessage } from './IMessage'

export class SetCameraMessage implements IMessage {
    constructor(private targetEntity: number) {}

    process(client: GameClient): void {
        console.log(`Setting camera target to entity ${this.targetEntity}`)
        client.world.myEntityId = this.targetEntity
    }
}
