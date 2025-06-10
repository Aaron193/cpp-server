import { PacketReader, ServerHeader } from '../packet'
import { GameClient } from '../GameClient'
import { Nicknames, Player } from '../graphics/Player'
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
                const tickrate = reader.readU8()
                client.world.interpolator.setTickrate(tickrate)
                client.world.cameraEntityId = entity
                client.world.active = true
                break
            }
            case ServerHeader.SET_CAMERA: {
                console.log('Set camera')
                const targetEntity = reader.readU32()
                client.world.cameraEntityId = targetEntity
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
                            entity = new Player(client, { id })
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

                    const interpolator = client.world.interpolator
                    interpolator.addSnapshot(entity, x, y, angle)

                    // todo: do this in the class or something
                    entity._id = id
                    entity._type = type
                    entity._x = x
                    entity._y = y
                    entity._angle = angle

                    client.world.entities.set(id, entity)
                }
                break
            }
            case ServerHeader.ENTITY_UPDATE: {
                const count = reader.readU32()

                for (let i = 0; i < count; i++) {
                    const id = reader.readU32()
                    const x = reader.readFloat()
                    const y = reader.readFloat()
                    const angle = reader.readFloat()
                    const entity = client.world.entities.get(id)!

                    assert(
                        entity != undefined,
                        `Entity with ID: ${id} not found`
                    )

                    const interpolator = client.world.interpolator
                    interpolator.addSnapshot(entity, x, y, angle)

                    // todo: do this in the class or some crap
                    entity._x = x
                    entity._y = y
                    entity._angle = angle
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
            case ServerHeader.ENTITY_STATE: {
                console.log('Entity state')
                const id = reader.readU32()
                const state = reader.readU8()
                const entity = client.world.entities.get(id)!
                assert(entity != undefined, `Entity with ID: ${id} not found`)

                entity._state |= state
                break
            }
            case ServerHeader.HEALTH: {
                console.log('Entity health')
                const health = reader.readFloat()
                assert(health >= 0, 'Health cannot be negative')

                // get hud
                const hud = client.world.renderer.hud
                hud.healthBar.setHealth(health)
                break
            }
            case ServerHeader.DIED: {
                console.log('Entity Died')

                // get hud
                const world = client.world
                world.active = false
                break
            }
            case ServerHeader.PLAYER_JOIN: {
                console.log('Player join')
                const id = reader.readU32()
                const name = reader.readString()

                Nicknames.set(id, name)
                break
            }
            case ServerHeader.PLAYER_LEAVE: {
                console.log('Player leave')
                const id = reader.readU32()

                Nicknames.delete(id)
                break
            }
            default:
                throw new Error(`Unknown message type: ${messageType}`)
        }
    }
}
