import { GameClient } from '../../GameClient'

export interface IMessage {
    process(client: GameClient): void
}
