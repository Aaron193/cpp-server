import * as PIXI from 'pixi.js'
import { CircularBuffer, Snapshot } from '../Interpolator'

// TODO: i think abstract is holding me back a bit, i kinda want default implementations
// for some methods to inherit from
export abstract class Entity extends PIXI.Container {
    // '_' = Properties read over network
    _id: number = -1
    _type: number = -1
    _x: number = 0
    _y: number = 0
    _angle: number = 0
    /**
     * Bitmask representing the state of the entity.
     */
    _state: number = 0

    // for interpolation - using circular buffer to prevent allocations
    interpolate: boolean = false
    snapshots: CircularBuffer<Snapshot> = new CircularBuffer<Snapshot>(16)

    abstract update(delta: number, tick: number, now: number): void

    abstract setRot(angle: number): void
    abstract getRot(): number
}
