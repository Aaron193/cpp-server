import { Entity } from './graphics/Entity'
import { assert } from './utils/assert'
import { World } from './World'

const PI2 = Math.PI * 2
const DEFAULT_TICKRATE = 10
const OFFSET_LERP_ALPHA = 0.1

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

export class Interpolator {
    world: World
    // Duration of a single server tick in milliseconds
    serverTickDurationMs: number = 1000 / DEFAULT_TICKRATE
    // Client-side interpolation delay (jitter buffer) in milliseconds
    interpolationDelayMs: number = this.serverTickDurationMs * 2
    // Maximum history to retain before pruning
    maxHistoryMs: number = this.interpolationDelayMs * 3
    // Smoothed offset from client clock to server simulation time
    serverTimeOffsetMs: number = 0
    offsetInitialized: boolean = false

    constructor(world: World) {
        this.world = world
    }

    setTickrate(tickrate: number) {
        assert(tickrate > 0, 'Tickrate must be greater than 0')
        this.serverTickDurationMs = 1000 / tickrate

        // Keep interpolation delay stable; only increase instantly, never snap down
        const targetDelay = this.serverTickDurationMs * 2
        if (targetDelay > this.interpolationDelayMs) {
            this.interpolationDelayMs = targetDelay
            this.maxHistoryMs = this.interpolationDelayMs * 3
        }

        console.log('setting tickrate to ', tickrate)
    }

    updateServerTimeOffset(serverTimeMs: number) {
        const clientNow = performance.now()
        const targetOffset = serverTimeMs - clientNow

        // Fast-start: snap on first sample to avoid long warm-up wait
        if (!this.offsetInitialized) {
            this.serverTimeOffsetMs = targetOffset
            this.offsetInitialized = true
            return
        }

        // If we are way off (e.g., server running long before client connects),
        // snap most of the distance to reduce visible stalls.
        const LARGE_OFFSET_MS = 2000
        if (Math.abs(targetOffset - this.serverTimeOffsetMs) > LARGE_OFFSET_MS) {
            this.serverTimeOffsetMs = targetOffset
            return
        }

        this.serverTimeOffsetMs = lerp(
            this.serverTimeOffsetMs,
            targetOffset,
            OFFSET_LERP_ALPHA
        )
    }

    addSnapshot(
        entity: Entity,
        x: number,
        y: number,
        angle: number,
        serverTimeMs: number
    ) {
        if (!entity.interpolate) {
            return
        }

        entity.snapshots.push({
            x: x,
            y: y,
            angle: angle,
            serverTime: serverTimeMs,
        })
    }

    update(_delta: number, _tick: number, currentTime: number) {
        this.world.entities.forEach((entity) => {
            if (entity.interpolate) {
                const snapshots = entity.snapshots
                const renderTime =
                    currentTime +
                    this.serverTimeOffsetMs -
                    this.interpolationDelayMs
                const historyLimit = renderTime - this.maxHistoryMs

                // Clear old snapshots that are more than 3 timesteps behind renderTime
                snapshots.removeWhile(
                    (snapshot) => snapshot.serverTime < historyLimit
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

                    if (snapshot.serverTime <= renderTime) {
                        snapshotA = snapshot
                    } else {
                        snapshotB = snapshot
                        break
                    }
                }

                if (snapshotA && snapshotB) {
                    if (snapshotB.serverTime === snapshotA.serverTime) {
                        // (we should never get here)
                        entity.position.set(snapshotA.x, snapshotA.y)
                        entity.setRot(snapshotA.angle)
                    } else {
                        // How far between A and B are we? 0-1
                        const t = Math.max(
                            0,
                            Math.min(
                                1,
                                (renderTime - snapshotA.serverTime) /
                                    (snapshotB.serverTime - snapshotA.serverTime)
                            )
                        )

                        const x = snapshotA.x + (snapshotB.x - snapshotA.x) * t
                        const y = snapshotA.y + (snapshotB.y - snapshotA.y) * t

                        let angleA = snapshotA.angle
                        let angleB = snapshotB.angle

                        // Rotate the shortest way (prevent spinning when crossing 2pi or 0)
                        const delta = (angleB - angleA) % PI2
                        const angle = angleA + (((2 * delta) % PI2) - delta) * t

                        entity.position.set(x, y)
                        entity.setRot(angle)
                        entity.lastRenderX = x
                        entity.lastRenderY = y
                        entity.lastRenderAngle = angle
                    }

                    // We don't have enough data to interpolate
                } else if (snapshotA && !snapshotB) {
                    if (entity.lastRenderX !== undefined) {
                        entity.position.set(entity.lastRenderX, entity.lastRenderY)
                        entity.setRot(entity.lastRenderAngle ?? snapshotA.angle)
                    } else {
                        entity.position.set(snapshotA.x, snapshotA.y)
                        entity.setRot(snapshotA.angle)
                        entity.lastRenderX = snapshotA.x
                        entity.lastRenderY = snapshotA.y
                        entity.lastRenderAngle = snapshotA.angle
                    }
                } else if (!snapshotA && snapshotB) {
                    if (entity.lastRenderX !== undefined) {
                        entity.position.set(entity.lastRenderX, entity.lastRenderY)
                        entity.setRot(entity.lastRenderAngle ?? snapshotB.angle)
                    } else {
                        entity.position.set(snapshotB.x, snapshotB.y)
                        entity.setRot(snapshotB.angle)
                        entity.lastRenderX = snapshotB.x
                        entity.lastRenderY = snapshotB.y
                        entity.lastRenderAngle = snapshotB.angle
                    }
                } else if (snapshots.getSize() > 0) {
                    const mostRecent = snapshots.get(snapshots.getSize() - 1)
                    if (mostRecent) {
                        entity.position.set(mostRecent.x, mostRecent.y)
                        entity.setRot(mostRecent.angle)
                        entity.lastRenderX = mostRecent.x
                        entity.lastRenderY = mostRecent.y
                        entity.lastRenderAngle = mostRecent.angle
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
    serverTime: number
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
