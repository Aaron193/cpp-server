import { Entity } from './graphics/Entity'
import { World } from './World'

interface SnapShop {
    x: number
    y: number
    angle: number
    timestamp: number
}

const TPS = 10
const TIMESTEP = 1000 / TPS

const PI2 = Math.PI * 2

export class Interpolator {
    world: World

    constructor(world: World) {
        this.world = world
    }

    addSnapshot(entity: Entity, x: number, y: number, angle: number) {
        if (!entity.interpolate) {
            return
        }

        const snapshots = entity.snapshots
        snapshots.push({
            x: x,
            y: y,
            angle: angle,
            timestamp: performance.now(), // TODO: use time from game loop?
        })
    }

    update(delta: number, tick: number, currentTime: number) {
        this.world.entities.forEach((entity) => {
            if (entity.interpolate) {
                const snapshots = entity.snapshots
                const renderTime = currentTime - TIMESTEP
                const historyLimit = renderTime - TIMESTEP * 3

                while (
                    snapshots.length > 0 &&
                    snapshots[0].timestamp < historyLimit
                ) {
                    snapshots.shift()
                }

                if (snapshots.length === 0) {
                    return
                }

                // interpolate between two snapshots
                let snapshotA: SnapShop | null = null
                let snapshotB: SnapShop | null = null

                for (let i = 0; i < snapshots.length; i++) {
                    if (snapshots[i].timestamp <= renderTime) {
                        snapshotA = snapshots[i]
                    } else {
                        snapshotB = snapshots[i]
                        break
                    }
                }

                if (snapshotA && snapshotB) {
                    if (snapshotB.timestamp === snapshotA.timestamp) {
                        // (we should never get here)
                        entity.position.set(snapshotA.x, snapshotA.y)
                        entity.setRot(snapshotA.angle)
                    } else {
                        const t =
                            (renderTime - snapshotA.timestamp) /
                            (snapshotB.timestamp - snapshotA.timestamp)
                        const x = snapshotA.x + (snapshotB.x - snapshotA.x) * t
                        const y = snapshotA.y + (snapshotB.y - snapshotA.y) * t

                        let angleA = snapshotA.angle
                        let angleB = snapshotB.angle

                        const delta = (angleB - angleA) % PI2
                        const angle = angleA + (((2 * delta) % PI2) - delta) * t

                        entity.position.set(x, y)
                        entity.setRot(angle)
                    }
                } else if (snapshotA && !snapshotB) {
                    entity.position.set(snapshotA.x, snapshotA.y)
                    entity.setRot(snapshotA.angle)
                } else if (!snapshotA && snapshotB) {
                    entity.position.set(snapshotB.x, snapshotB.y)
                    entity.setRot(snapshotB.angle)
                } else if (snapshots.length > 0) {
                    const mostRecent = snapshots[snapshots.length - 1]
                    entity.position.set(mostRecent.x, mostRecent.y)
                    entity.setRot(mostRecent.angle)
                }
            }
        })
    }
}
