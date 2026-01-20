import { PacketReader, ServerHeader } from '../packet'
import { GameClient } from '../GameClient'
import { Nicknames, Player } from '../graphics/Player'
import { assert } from '../utils/assert'
import { Entity } from '../graphics/Entity'
import { EntityTypes } from '../enums/EntityTypes'
import { Crate } from '../graphics/Crate'
import { BasicSprite } from '../graphics/BasicSprite'
import { NewsType } from '../enums/NewsType'
import { AssetLoader } from '../graphics/utils/AssetLoader'
import { Bullet } from '../graphics/Bullet'
import { HitscanTracer } from '../graphics/HitscanTracer'
import { ItemType } from '../enums/ItemType'

export class MessageHandler {
    static handle(reader: PacketReader, client: GameClient): void {
        const messageType = reader.readU8()

        switch (messageType) {
            case ServerHeader.MAP_INIT: {
                const size = reader.readU32()
                console.log('Map initialized with size: ', size)
                break
            }
            case ServerHeader.SPAWN_SUCCESS: {
                console.log('Spawn success')
                const entity = reader.readU32()
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
                    const variant = reader.readU8()
                    const x = reader.readFloat()
                    const y = reader.readFloat()
                    const angle = reader.readFloat()

                    let entity: Entity

                    // Get entity type name for debug labels
                    const typeNames = [
                        'SPECTATOR',
                        'PLAYER',
                        'CRATE',
                        'BUSH',
                        'ROCK',
                        'WALL',
                        'FENCE',
                        'TREE',
                        'BULLET',
                    ]
                    const typeName = typeNames[type] || `TYPE_${type}`

                    switch (type) {
                        case EntityTypes.PLAYER: {
                            entity = new Player(client, { id })
                            break
                        }
                        case EntityTypes.CRATE: {
                            entity = new Crate(client)
                            break
                        }
                        case EntityTypes.BUSH:
                        case EntityTypes.ROCK:
                        case EntityTypes.WALL:
                        case EntityTypes.FENCE:
                        case EntityTypes.TREE: {
                            const debugLabel = `${typeName}\nID:${id}`
                            entity = new BasicSprite(
                                client,
                                AssetLoader.getTextureFromType(type, variant),
                                debugLabel
                            )
                            console.log('creating from type: ', type)
                            break
                        }
                        case EntityTypes.BULLET: {
                            entity = new Bullet(client)
                            break
                        }
                        default: {
                            return assert(false, `Unknown entity type: ${type}`)
                        }
                    }

                    // sprite render order will be based on their type (just keep each type on a new layer)
                    entity.zIndex = type

                    const interpolator = client.world.interpolator
                    interpolator.addSnapshot(entity, x, y, angle)

                    // todo: do this in the class or something
                    entity._id = id
                    entity._type = type
                    entity._x = x
                    entity._y = y
                    entity._angle = angle

                    entity.position.x = x
                    entity.position.y = y
                    entity.setRot(angle)

                    // set render position on entities as they are created

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
            case ServerHeader.INVENTORY_UPDATE: {
                const activeSlot = reader.readU8()
                client.world.activeSlot = activeSlot

                for (let i = 0; i < 5; i++) {
                    const type = reader.readU8() as ItemType
                    const fireMode = reader.readU8()
                    const ammoType = reader.readU8()
                    const magazineSize = reader.readU16()
                    const ammoInMag = reader.readU16()
                    const reloadRemaining = reader.readFloat()

                    client.world.inventorySlots[i] = {
                        type,
                        fireMode,
                        ammoType,
                        magazineSize,
                        ammoInMag,
                        reloadRemaining,
                    }
                }
                break
            }
            case ServerHeader.AMMO_UPDATE: {
                const ammoInMag = reader.readU16()
                const ammoReserve = reader.readU16()
                const reloadRemaining = reader.readFloat()

                client.world.activeAmmoInMag = ammoInMag
                client.world.activeAmmoReserve = ammoReserve
                client.world.activeReloadRemaining = reloadRemaining
                break
            }
            case ServerHeader.BULLET_TRACE: {
                const shooter = reader.readU32() // prob can get rid of this
                const startX = reader.readFloat()
                const startY = reader.readFloat()
                const endX = reader.readFloat()
                const endY = reader.readFloat()

                const tracer = new HitscanTracer(startX, startY, endX, endY)
                client.world.renderer.foreground.addChild(tracer)
                client.world.addEffect(tracer)
                break
            }
            case ServerHeader.PROJECTILE_SPAWN_BATCH: {
                const serverTick = reader.readU64()
                client.world.lastKnownServerTick = serverTick

                const count = reader.readU32()
                const tickRate = client.world.interpolator.getTickrate()
                const maxCatchupTicks = 200

                for (let i = 0; i < count; i++) {
                    const id = reader.readU32()
                    const originX = reader.readFloat()
                    const originY = reader.readFloat()
                    const dirX = reader.readFloat()
                    const dirY = reader.readFloat()
                    const speed = reader.readFloat()
                    const spawnTick = reader.readU64()

                    if (client.world.pendingProjectileDestroys.has(id)) {
                        client.world.pendingProjectileDestroys.delete(id)
                        continue
                    }

                    const elapsedTicks = Math.max(0, serverTick - spawnTick)

                    if (elapsedTicks > maxCatchupTicks) {
                        continue
                    }

                    const elapsedTime = elapsedTicks / tickRate
                    const posX = originX + dirX * speed * elapsedTime
                    const posY = originY + dirY * speed * elapsedTime

                    const existing = client.world.projectiles.get(id)
                    if (existing) {
                        existing.destroy()
                        client.world.projectiles.delete(id)
                    }

                    const bullet = new Bullet(client)
                    bullet._id = id
                    bullet._type = EntityTypes.BULLET
                    bullet.position.set(posX, posY)
                    bullet.setMotion(dirX, dirY, speed)
                    client.world.addProjectile(bullet)
                }
                break
            }
            case ServerHeader.PROJECTILE_DESTROY: {
                const id = reader.readU32()
                client.world.removeProjectile(id)
                break
            }
            case ServerHeader.HEALTH: {
                console.log('Entity health')
                const health = reader.readFloat()
                assert(health >= 0, 'Health cannot be negative')

                const hud = client.world.renderer.hud
                hud.healthBar.setHealth(health)
                break
            }
            case ServerHeader.DIED: {
                console.log('Entity Died')

                const world = client.world
                world.active = false

                const hud = world.renderer.hud
                hud.healthBar.setHealth(0)
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
            case ServerHeader.TPS: {
                console.log('Set tickrate')
                const tickrate = reader.readU8()
                client.world.interpolator.setTickrate(tickrate)
                break
            }
            case ServerHeader.NEWS: {
                console.log('News')
                const type = reader.readU8()
                switch (type) {
                    case NewsType.TEXT: {
                        const text = reader.readString()

                        const newsFeed = client.world.renderer.hud.newsFeed
                        newsFeed.addMessage(text)
                        break
                    }
                    case NewsType.KILL: {
                        const subject = reader.readU32()
                        const killer = reader.readU32()

                        assert(
                            Nicknames.has(subject),
                            'Subject nickname not found'
                        )
                        assert(
                            Nicknames.has(killer),
                            'Killer nickname not found'
                        )

                        const subjectName = Nicknames.get(subject)
                        const killerName = Nicknames.get(killer)

                        const newsFeed = client.world.renderer.hud.newsFeed
                        newsFeed.addMessage(
                            `${killerName} has eliminated ${subjectName} with fists` // TODO: weapon name
                        )
                        break
                    }
                }
                break
            }
            case ServerHeader.SERVER_CHAT: {
                console.log('Received a chat message!')
                const id = reader.readU32()
                const message = reader.readString()

                assert(
                    client.world.entities.has(id),
                    'Chat sender entity not found'
                )

                const entity = client.world.entities.get(id)! as Player
                entity.receivedChat(message)

                break
            }
            case ServerHeader.BIOME_CREATE: {
                console.log('Biome create')
                const id = reader.readU32()
                const biome = reader.readU8()

                // Encoding: 0 = float world pixels, 1 = uint16 heightmap units
                const encoding = reader.readU8()
                const HEIGHTMAP_SCALE = 64

                // Read vertices
                const vertexCount = reader.readU32()
                const vertices: { x: number; y: number }[] = []
                for (let i = 0; i < vertexCount; i++) {
                    if (encoding === 1) {
                        const x = reader.readU16() * HEIGHTMAP_SCALE
                        const y = reader.readU16() * HEIGHTMAP_SCALE
                        vertices.push({ x, y })
                    } else {
                        const x = reader.readFloat()
                        const y = reader.readFloat()
                        vertices.push({ x, y })
                    }
                }

                // Read indices
                const indexCount = reader.readU32()
                const indices: number[] = []
                for (let i = 0; i < indexCount; i++) {
                    indices.push(reader.readU32())
                }

                // Add terrain mesh to renderer
                client.world.renderer.terrainRenderer.addTerrainMesh(
                    id,
                    biome,
                    vertices,
                    indices
                )

                break
            }
            default:
                assert(false, `Unknown message type: ${messageType}`)
        }
    }
}
