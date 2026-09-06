import { readFile } from 'node:fs/promises'
import initJolt from 'jolt-physics/wasm-compat'
import { parseCollisionMesh } from '../src/foundation/assets/CollisionMesh'
import { JoltCharacterWorld } from '../src/foundation/physics/JoltCharacterWorld'

const Jolt = await initJolt()
for (const mapId of ['graybox-arena', 'copper-yard', 'ironworks']) {
    const root = new URL(`../public/maps/${mapId}/`, import.meta.url)
    const collision = parseCollisionMesh(
        await readFile(new URL('collision.bin', root))
    )
    const gameplay = JSON.parse(
        await readFile(new URL('gameplay.json', root), 'utf8')
    ) as {
        spawnPoints: {
            id: string
            position: [number, number, number]
            yaw: number
        }[]
    }
    const spawn = gameplay.spawnPoints[0]
    const world = new JoltCharacterWorld(Jolt, collision, {
        x: spawn.position[0],
        y: spawn.position[1],
        z: spawn.position[2],
    })
    let lowest = Number.POSITIVE_INFINITY,
        highest = Number.NEGATIVE_INFINITY
    for (let tick = 0; tick < 240; tick++) {
        world.step(
            {
                forward: tick > 60 ? 1 : 0,
                right: 0,
                jump: tick === 100,
                yaw: spawn.yaw,
            },
            1 / 60
        )
        lowest = Math.min(lowest, world.position.y)
        highest = Math.max(highest, world.position.y)
    }
    const position = world.position,
        velocity = world.velocity
    if (
        ![
            position.x,
            position.y,
            position.z,
            velocity.x,
            velocity.y,
            velocity.z,
        ].every(Number.isFinite)
    )
        throw new Error(`${mapId}: Jolt smoke produced non-finite state`)
    if (
        lowest < collision.bounds.min[1] - 0.1 ||
        position.x < collision.bounds.min[0] ||
        position.x > collision.bounds.max[0] ||
        position.z < collision.bounds.min[2] ||
        position.z > collision.bounds.max[2]
    )
        throw new Error(`${mapId}: character escaped authored collision`)
    console.log(
        `${mapId} Jolt traversal OK: pos=${position.x.toFixed(2)},${position.y.toFixed(2)},${position.z.toFixed(2)} vertical=${lowest.toFixed(2)}..${highest.toFixed(2)} grounded=${world.grounded}`
    )
    if (mapId === 'ironworks')
        for (const point of gameplay.spawnPoints) {
            const [x, y, z] = point.position
            world.setState({ x, y, z }, { x: 0, y: 0, z: 0 })
            for (let tick = 0; tick < 60; tick++)
                world.step(
                    { forward: 0, right: 0, jump: false, yaw: point.yaw },
                    1 / 60
                )
            const pos = world.position
            if (
                !world.grounded ||
                Math.hypot(pos.x - x, pos.z - z) > 1 ||
                Math.abs(pos.y - y) > 0.4
            )
                throw new Error(
                    `${mapId}: obstructed or unsupported spawn ${point.id}: ${JSON.stringify(pos)}`
                )
        }
    if (mapId === 'ironworks') {
        world.setState({ x: -88, y: 0.08, z: 0 }, { x: 0, y: 0, z: 0 })
        let underground = false
        for (let tick = 0; tick < 2200 && world.position.x < 88; tick++) {
            world.step(
                { forward: 1, right: 0, jump: false, yaw: Math.PI / 2 },
                1 / 60
            )
            if (
                world.position.x > -60 &&
                world.position.x < 60 &&
                world.position.y < -2.5
            )
                underground = true
        }
        if (!underground || world.position.x < 86 || world.position.y < -0.3)
            throw new Error(
                `ironworks: service gallery is not traversable: ${JSON.stringify(world.position)}`
            )
        for (const cx of [-42, 42])
            for (const side of [-1, 1])
                for (const end of [-1, 1]) {
                    world.setState(
                        { x: cx + side * 21, y: 0.08, z: end * 40 },
                        { x: 0, y: 0, z: 0 }
                    )
                    for (let tick = 0; tick < 230; tick++)
                        world.step(
                            {
                                forward: 1,
                                right: 0,
                                jump: false,
                                yaw: end < 0 ? Math.PI : 0,
                            },
                            1 / 60
                        )
                    if (
                        !world.grounded ||
                        world.position.y < 3.9 ||
                        world.position.y > 4.1
                    )
                        throw new Error(
                            `ironworks: inaccessible mezzanine ${cx}/${side}/${end}: ${JSON.stringify(world.position)}`
                        )
                }
        console.log(
            'ironworks: all 31 spawns clear; service gallery and all 8 mezzanine stairways traversable'
        )
    }
    world.dispose()
}
