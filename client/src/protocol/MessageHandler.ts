import { PacketReader, ServerHeader } from '../packet'
import { GameClient } from '../GameClient'
import { Player } from '../graphics/Player'
import { assert } from '../utils/assert'

export class MessageHandler {
    static handle(reader: PacketReader, client: GameClient): void {
        const messageType = reader.readU8()

        switch (messageType) {
            case ServerHeader.SPAWN_SUCCESS: {
                console.log('Spawn success')
                const entity = reader.readU32()
                client.world.myEntityId = entity
                break
            }
            case ServerHeader.SET_CAMERA: {
                console.log('Set camera')
                const targetEntity = reader.readU32()
                client.world.myEntityId = targetEntity
                break
            }
            case ServerHeader.ENTITY_CREATE: {
                console.log('Entity create')
                const count = reader.readU32()

                for (let i = 0; i < count; i++) {
                    const id = reader.readU32()
                    const type = reader.readU8()
                    const x = reader.readFloat()
                    const y = reader.readFloat()
                    const angle = reader.readFloat()

                    const player = new Player(client)
                    player.position.x = x
                    player.position.y = y
                    player.angle = angle
                    player.id = id
                    player.type = type
                    player.name = `Player ${id}`

                    client.world.entities.set(id, player)
                }
                break
            }
            case ServerHeader.ENTITY_UPDATE: {
                console.log('Entity update')
                const count = reader.readU32()

                for (let i = 0; i < count; i++) {
                    const id = reader.readU32()
                    const x = reader.readFloat()
                    const y = reader.readFloat()
                    const angle = reader.readFloat()
                    const player = client.world.entities.get(id)!

                    assert(
                        player != undefined,
                        `Entity with ID: ${id} not found`
                    )

                    player.position.x = x
                    player.position.y = y
                    player.angle = angle
                }
                break
            }
            case ServerHeader.ENTITY_REMOVE: {
                console.log('Entity remove')
                const count = reader.readU32()

                for (let i = 0; i < count; i++) {
                    const id = reader.readU32()
                    const entity = client.world.entities.get(id)!
                    assert(
                        entity != undefined,
                        `Entity with ID: ${id} not found`
                    )

                    entity.destroy()
                    client.world.entities.delete(id)
                }
                break
            }
            default:
                throw new Error(`Unknown message type: ${messageType}`)
        }
    }
}
