import { Entity } from './graphics/Entity'
import { assert } from './utils/assert'
import { World } from './World'

const PI2 = Math.PI * 2

export class Interpolator {
    world: World
    timestep: number = 10

    constructor(world: World) {
        this.world = world
    }

    setTickrate(tickrate: number) {
        assert(tickrate > 0, 'Tickrate must be greater than 0')
        this.timestep = 1000 / tickrate
        console.log('setting tickrate to ', tickrate)
    }

    getTickrate(): number {
        return 1000 / this.timestep
    }

    addSnapshot(entity: Entity, x: number, y: number, angle: number) {
        if (!entity.interpolate) {
            return
        }

        entity.snapshots.push({
            x: x,
            y: y,
            angle: angle,
            timestamp: performance.now(), // TODO: use time from game loop?
        })
    }

    update(_delta: number, _tick: number, currentTime: number) {
        this.world.entities.forEach((entity) => {
            if (entity.interpolate) {
                const snapshots = entity.snapshots
                const renderTime = currentTime - this.timestep
                const historyLimit = renderTime - this.timestep * 3

                // Clear old snapshots that are more than 3 timesteps behind renderTime
                snapshots.removeWhile(
                    (snapshot) => snapshot.timestamp < historyLimit
                )

                if (snapshots.getSize() === 0) {
                    return
                }

                // interpolate between two snapshots
                let snapshotA: Snapshot | null = null // last snapshot before renderTime
                let snapshotB: Snapshot | null = null // first snapshot after renderTime

                for (let i = 0; i < snapshots.getSize(); i++) {
                    const snapshot = snapshots.get(i)
                    if (!snapshot) continue

                    if (snapshot.timestamp <= renderTime) {
                        snapshotA = snapshot
                    } else {
                        snapshotB = snapshot
                        break
                    }
                }

                if (snapshotA && snapshotB) {
                    if (snapshotB.timestamp === snapshotA.timestamp) {
                        // (we should never get here)
                        entity.position.set(snapshotA.x, snapshotA.y)
                        entity.setRot(snapshotA.angle)
                    } else {
                        // How far between A and B are we? 0-1
                        const t =
                            (renderTime - snapshotA.timestamp) /
                            (snapshotB.timestamp - snapshotA.timestamp)

                        const x = snapshotA.x + (snapshotB.x - snapshotA.x) * t
                        const y = snapshotA.y + (snapshotB.y - snapshotA.y) * t

                        let angleA = snapshotA.angle
                        let angleB = snapshotB.angle

                        // Rotate the shortest way (prevent spinning when crossing 2pi or 0)
                        const delta = (angleB - angleA) % PI2
                        const angle = angleA + (((2 * delta) % PI2) - delta) * t

                        entity.position.set(x, y)
                        entity.setRot(angle)
                    }

                    // We don't have enough data to interpolate
                } else if (snapshotA && !snapshotB) {
                    entity.position.set(snapshotA.x, snapshotA.y)
                    entity.setRot(snapshotA.angle)
                } else if (!snapshotA && snapshotB) {
                    entity.position.set(snapshotB.x, snapshotB.y)
                    entity.setRot(snapshotB.angle)
                } else if (snapshots.getSize() > 0) {
                    const mostRecent = snapshots.get(snapshots.getSize() - 1)
                    if (mostRecent) {
                        entity.position.set(mostRecent.x, mostRecent.y)
                        entity.setRot(mostRecent.angle)
                    }
                }
            }
        })
    }
}

export interface Snapshot {
    x: number
    y: number
    angle: number
    timestamp: number
}

export class CircularBuffer<T> {
    private buffer: T[]
    private head: number = 0
    private tail: number = 0
    private size: number = 0
    private capacity: number

    constructor(capacity: number) {
        this.capacity = capacity
        this.buffer = new Array(capacity)
    }

    push(item: T): void {
        this.buffer[this.tail] = item
        this.tail = (this.tail + 1) % this.capacity

        if (this.size < this.capacity) {
            this.size++
        } else {
            this.head = (this.head + 1) % this.capacity
        }
    }

    get(index: number): T | undefined {
        if (index >= this.size) {
            return undefined
        }
        const actualIndex = (this.head + index) % this.capacity
        return this.buffer[actualIndex]
    }

    removeOldest(): T | undefined {
        if (this.size === 0) {
            return undefined
        }

        const item = this.buffer[this.head]
        this.head = (this.head + 1) % this.capacity
        this.size--
        return item
    }

    getSize(): number {
        return this.size
    }

    clear(): void {
        this.head = 0
        this.tail = 0
        this.size = 0
    }

    // Remove items from the front while condition is true
    removeWhile(predicate: (item: T) => boolean): void {
        while (this.size > 0) {
            const item = this.get(0)
            if (!item || !predicate(item)) {
                break
            }
            this.removeOldest()
        }
    }
}
