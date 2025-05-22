import { PacketReader, ServerHeader } from '../../packet'
import { IMessage } from './IMessage'
import { SpawnSuccessMessage } from './messages'
import { EntityCreateMessage } from './EntityCreateMessage'
import { EntityUpdateMessage } from './EntityUpdateMessage'
import { EntityRemoveMessage } from './EntityRemoveMessage'
import { SetCameraMessage } from './SetCameraMessage'

/**
 * TODO: i don't like this. i think i want to just handle messages as soon as they come in, in-line with this switch statement.
 * Incoming websocket messages are processed after event loop anyways, so it should be fine to make this change^
 */
export class MessageFactory {
    static createMessage(reader: PacketReader): IMessage {
        const messageType = reader.readU8()

        switch (messageType) {
            case ServerHeader.SPAWN_SUCCESS: {
                const entity = reader.readU32()
                return new SpawnSuccessMessage(entity)
            }
            case ServerHeader.SET_CAMERA: {
                const targetEntity = reader.readU32()
                return new SetCameraMessage(targetEntity)
            }
            case ServerHeader.ENTITY_CREATE: {
                const count = reader.readU32()
                const entities: Array<{
                    id: number
                    type: number
                    x: number
                    y: number
                    angle: number
                }> = []

                for (let i = 0; i < count; i++) {
                    const id = reader.readU32()
                    const type = reader.readU8()
                    const x = reader.readFloat()
                    const y = reader.readFloat()
                    const angle = reader.readFloat()

                    entities.push({ id, type, x, y, angle })
                }

                return new EntityCreateMessage(entities)
            }
            case ServerHeader.ENTITY_UPDATE: {
                const count = reader.readU32()
                const entities: Array<{
                    id: number
                    x: number
                    y: number
                    angle: number
                }> = []

                for (let i = 0; i < count; i++) {
                    const id = reader.readU32()
                    const x = reader.readFloat()
                    const y = reader.readFloat()
                    const angle = reader.readFloat()

                    entities.push({ id, x, y, angle })
                }

                return new EntityUpdateMessage(entities)
            }
            case ServerHeader.ENTITY_REMOVE: {
                const count = reader.readU32()
                const entityIds: number[] = []

                for (let i = 0; i < count; i++) {
                    const id = reader.readU32()
                    entityIds.push(id)
                }

                return new EntityRemoveMessage(entityIds)
            }
            default:
                throw new Error(`Unknown message type: ${messageType}`)
        }
    }
}
