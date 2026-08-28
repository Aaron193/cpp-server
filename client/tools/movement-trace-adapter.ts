import { readFile } from 'node:fs/promises'
import initJolt from 'jolt-physics/wasm-compat'
import { parseCollisionMesh } from '../src/foundation/assets/CollisionMesh'
import { JoltCharacterWorld } from '../src/foundation/physics/JoltCharacterWorld'
import type { MovementTuning } from '../src/foundation/physics/Movement'

export interface MovementTraceCheckpoint {
    readonly tick: number
    readonly position: readonly [number, number, number]
    readonly velocity: readonly [number, number, number]
    readonly grounded: boolean
}
interface TraceSegment {
    readonly ticks: number
    readonly forward: number
    readonly right: number
    readonly jumpAt: readonly number[]
    readonly yaw: number
}
interface TraceFixture {
    readonly format: string
    readonly formatVersion: number
    readonly fixedDeltaSeconds: number
    readonly map: { readonly collisionAsset: string }
    readonly spawn: readonly [number, number, number]
    readonly tuning: MovementTuning
    readonly segments: readonly TraceSegment[]
    readonly checkpointTicks: readonly number[]
    readonly replayResetTicks?: readonly number[]
    readonly comparisonTolerance?: { readonly positionMeters: number; readonly velocityMetersPerSecond: number; readonly groundedMustMatch: boolean }
}

export const repositoryRoot = new URL('../../', import.meta.url)
export const movementTraceFixtureUrl = new URL('fixtures/movement/phase0-command-trace.json', repositoryRoot)

export async function runBrowserMovementTrace(fixtureUrl: URL = movementTraceFixtureUrl): Promise<readonly MovementTraceCheckpoint[]> {
    const fixture = JSON.parse(await readFile(fixtureUrl, 'utf8')) as TraceFixture
    if (fixture.format !== 'cpp-server-movement-trace' || fixture.formatVersion !== 1) throw new Error('Unsupported movement trace fixture')
    const collision = parseCollisionMesh(await readFile(new URL(fixture.map.collisionAsset, repositoryRoot)))
    const Jolt = await initJolt()
    const world = new JoltCharacterWorld(Jolt, collision, { x: fixture.spawn[0], y: fixture.spawn[1], z: fixture.spawn[2] }, fixture.tuning)
    const checkpoints: MovementTraceCheckpoint[] = []
    const states: MovementTraceCheckpoint[] = [{ tick: 0, position: [...fixture.spawn], velocity: [0, 0, 0], grounded: false }]
    const commands: Array<{ forward: number; right: number; jump: boolean; yaw: number }> = []
    let tick = 0
    for (const segment of fixture.segments) {
        const jumpTicks = new Set(segment.jumpAt)
        for (let segmentTick = 0; segmentTick < segment.ticks; segmentTick++) {
            const applied = { forward: segment.forward, right: segment.right, jump: jumpTicks.has(segmentTick), yaw: segment.yaw }
            commands.push(applied)
            world.step(applied, fixture.fixedDeltaSeconds)
            tick++
            const livePosition = world.position, liveVelocity = world.velocity
            states.push({ tick, position: [livePosition.x, livePosition.y, livePosition.z], velocity: [liveVelocity.x, liveVelocity.y, liveVelocity.z], grounded: world.grounded })
            if (fixture.replayResetTicks?.includes(tick)) {
                const resetTick = tick - 30, reset = states[resetTick]!, expected = states[tick]!
                world.setState({ x: reset.position[0], y: reset.position[1], z: reset.position[2] }, { x: reset.velocity[0], y: reset.velocity[1], z: reset.velocity[2] })
                for (let replayTick = resetTick; replayTick < tick; replayTick++) world.step(commands[replayTick]!, fixture.fixedDeltaSeconds)
                const replayedPosition = world.position, replayedVelocity = world.velocity
                const positionError = Math.hypot(replayedPosition.x - expected.position[0], replayedPosition.y - expected.position[1], replayedPosition.z - expected.position[2])
                const velocityError = Math.hypot(replayedVelocity.x - expected.velocity[0], replayedVelocity.y - expected.velocity[1], replayedVelocity.z - expected.velocity[2])
                if (positionError > (fixture.comparisonTolerance?.positionMeters ?? .35) || velocityError > (fixture.comparisonTolerance?.velocityMetersPerSecond ?? .5)) throw new Error(`Movement replay diverged at tick ${tick}: position=${positionError}, velocity=${velocityError}`)
                states[tick] = { tick, position: [replayedPosition.x, replayedPosition.y, replayedPosition.z], velocity: [replayedVelocity.x, replayedVelocity.y, replayedVelocity.z], grounded: world.grounded }
            }
            if (fixture.checkpointTicks.includes(tick)) {
                const position = world.position, velocity = world.velocity
                checkpoints.push({
                    tick,
                    position: [position.x, position.y, position.z],
                    velocity: [velocity.x, velocity.y, velocity.z],
                    grounded: world.grounded,
                })
            }
        }
    }
    world.dispose()
    if (checkpoints.length !== fixture.checkpointTicks.length) throw new Error('Movement trace did not visit every checkpoint')
    return checkpoints
}
