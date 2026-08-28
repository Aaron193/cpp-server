import { readFile } from 'node:fs/promises'
import initJolt from 'jolt-physics/wasm-compat'
import { parseCollisionMesh } from '../src/foundation/assets/CollisionMesh'
import { JoltCharacterWorld } from '../src/foundation/physics/JoltCharacterWorld'

const Jolt = await initJolt()
for (const mapId of ['graybox-arena', 'copper-yard']) {
    const root = new URL(`../public/maps/${mapId}/`, import.meta.url)
    const collision = parseCollisionMesh(await readFile(new URL('collision.bin', root)))
    const gameplay = JSON.parse(await readFile(new URL('gameplay.json', root), 'utf8')) as { spawnPoints: { position: [number, number, number]; yaw: number }[] }
    const spawn = gameplay.spawnPoints[0]
    const world = new JoltCharacterWorld(Jolt, collision, { x: spawn.position[0], y: spawn.position[1], z: spawn.position[2] })
    let lowest = Number.POSITIVE_INFINITY, highest = Number.NEGATIVE_INFINITY
    for (let tick = 0; tick < 240; tick++) {
        world.step({ forward: tick > 60 ? 1 : 0, right: 0, jump: tick === 100, yaw: spawn.yaw }, 1 / 60)
        lowest = Math.min(lowest, world.position.y); highest = Math.max(highest, world.position.y)
    }
    const position = world.position, velocity = world.velocity
    if (![position.x, position.y, position.z, velocity.x, velocity.y, velocity.z].every(Number.isFinite)) throw new Error(`${mapId}: Jolt smoke produced non-finite state`)
    if (lowest < collision.bounds.min[1] - 0.1 || position.x < collision.bounds.min[0] || position.x > collision.bounds.max[0] || position.z < collision.bounds.min[2] || position.z > collision.bounds.max[2]) throw new Error(`${mapId}: character escaped authored collision`)
    console.log(`${mapId} Jolt traversal OK: pos=${position.x.toFixed(2)},${position.y.toFixed(2)},${position.z.toFixed(2)} vertical=${lowest.toFixed(2)}..${highest.toFixed(2)} grounded=${world.grounded}`)
    world.dispose()
}
