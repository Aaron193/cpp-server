import { readFile } from 'node:fs/promises'
import initJolt from 'jolt-physics/wasm-compat'
import { parseCollisionMesh } from '../src/foundation/assets/CollisionMesh'
import { JoltCharacterWorld } from '../src/foundation/physics/JoltCharacterWorld'

const bytes = await readFile(new URL('../public/maps/graybox-arena/collision.bin', import.meta.url))
const collision = parseCollisionMesh(bytes)
const Jolt = await initJolt()
const world = new JoltCharacterWorld(Jolt, collision, { x: 25, y: 0.1, z: -8 })
for (let tick = 0; tick < 180; tick++) {
    world.step({ forward: tick > 60 ? 1 : 0, right: 0, jump: tick === 75, yaw: -Math.PI / 2 }, 1 / 60)
}
const position = world.position
const velocity = world.velocity
if (![position.x, position.y, position.z, velocity.x, velocity.y, velocity.z].every(Number.isFinite)) throw new Error('Jolt smoke produced non-finite state')
if (world.position.y < -2) throw new Error(`Jolt character fell through authored collision: y=${world.position.y}`)
console.log(`Jolt smoke OK: pos=${position.x.toFixed(2)},${position.y.toFixed(2)},${position.z.toFixed(2)} grounded=${world.grounded}`)
world.dispose()
