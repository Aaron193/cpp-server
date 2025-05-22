export interface IEntity {
    id: number
    type: number
    angle: number
    // TODO: add x,y for interpolation (need server side pos), PIXI position (position.x/y) will be for rendering interpolated values
}
