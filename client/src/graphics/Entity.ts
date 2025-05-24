import * as PIXI from 'pixi.js'

export abstract class Entity extends PIXI.Container {
    _id: number = -1
    _type: number = -1
    _x: number = 0
    _y: number = 0
    _angle: number = 0

    // for interpolation
    interpolate: boolean = false
    snapshots: { x: number; y: number; angle: number; timestamp: number }[] = []

    abstract update(delta: number, tick: number, now: number): void

    abstract setRot(angle: number): void
}
