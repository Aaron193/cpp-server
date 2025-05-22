import * as PIXI from 'pixi.js'

export abstract class Entity extends PIXI.Container {
    id: number = -1
    type: number = -1

    abstract update(delta: number): void
}
