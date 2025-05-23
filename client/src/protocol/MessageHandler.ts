import { PacketReader, ServerHeader } from '../packet'
import { GameClient } from '../GameClient'
import { Player } from '../graphics/Player'
import { assert } from '../utils/assert'
import { Entity } from '../graphics/Entity'
import { EntityTypes } from '../EntityTypes'
import { Crate } from '../graphics/Crate'

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

                    let entity: Entity

                    switch (type) {
                        case EntityTypes.PLAYER: {
                            entity = new Player(client)
                            break
                        }
                        case EntityTypes.CRATE: {
                            entity = new Crate(client)
                            break
                        }
                        default: {
                            throw new Error(`Unknown entity type: ${type}`)
                        }
                    }

                    entity.position.x = x
                    entity.position.y = y
                    entity.angle = angle
                    entity.id = id
                    entity.type = type
                    entity.name = `Player ${id}`

                    client.world.entities.set(id, entity)
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
