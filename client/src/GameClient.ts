import { Player } from './graphics/Player'
import { ClientHeader } from './packet'
import { Socket } from './protocol/socket'
import { World } from './World'

export class GameClient {
    world: World
    socket: Socket = new Socket(this)
    lastSendDirection: number = 0
    currentDirection: number = 0

    mouseX: number = 0
    mouseY: number = 0
    lastSendAngle: number = 0

    private constructor(world: World) {
        this.world = world
        this.socket.connect()

        // keyboard
        window.addEventListener('keydown', (event) => this.onKeyDown(event))
        window.addEventListener('keyup', (event) => this.onKeyUp(event))

        // mouse
        const canvas = this.world.renderer.canvas
        canvas.addEventListener('mousemove', (event) => this.onMouseMove(event))
        canvas.addEventListener('mousedown', (event) =>
            this.onMouseClick(event, true)
        )
        canvas.addEventListener('mouseup', (event) =>
            this.onMouseClick(event, false)
        )
    }

    public static async create(): Promise<GameClient> {
        const world = await World.create()
        return new GameClient(world)
    }

    update(delta: number, tick: number, now: number) {
        this.world.update(delta, tick, now)

        // socket event-triggered messages or whatever
        this.sendInputDirection(this.currentDirection)

        // get my player
        if (this.world.entities.has(this.world.myEntityId)) {
            const myEntity = this.world.entities.get(
                this.world.myEntityId
            )! as Player

            this.sendInputAngle(myEntity.body.rotation)
        }

        this.socket.flush()
    }

    private sendInputDirection(direction: number) {
        if (this.lastSendDirection !== direction) {
            this.lastSendDirection = direction
            this.socket.streamWriter.writeU8(ClientHeader.MOVEMENT)
            this.socket.streamWriter.writeU8(direction)
        }
    }

    private sendInputAngle(angle: number) {
        if (this.lastSendAngle !== angle) {
            this.lastSendAngle = angle
            this.socket.streamWriter.writeU8(ClientHeader.MOUSE)
            this.socket.streamWriter.writeFloat(angle)
        }
    }

    private onKeyDown(event: KeyboardEvent) {
        switch (event.key) {
            case 'w':
            case 'ArrowUp':
                this.currentDirection |= 1
                break
            case 'a':
            case 'ArrowLeft':
                this.currentDirection |= 2
                break
            case 's':
            case 'ArrowDown':
                this.currentDirection |= 4
                break
            case 'd':
            case 'ArrowRight':
                this.currentDirection |= 8
                break
        }
    }

    private onKeyUp(event: KeyboardEvent) {
        switch (event.key) {
            case 'w':
            case 'ArrowUp':
                this.currentDirection &= ~1
                break
            case 'a':
            case 'ArrowLeft':
                this.currentDirection &= ~2
                break
            case 's':
            case 'ArrowDown':
                this.currentDirection &= ~4
                break
            case 'd':
            case 'ArrowRight':
                this.currentDirection &= ~8
                break
        }
    }

    private onMouseMove(event: MouseEvent) {
        const canvas = this.world.renderer.canvas
        const rect = canvas.getBoundingClientRect()
        const x = event.clientX - rect.left
        const y = event.clientY - rect.top

        this.mouseX = x
        this.mouseY = y
    }

    private onMouseClick(event: MouseEvent, isDown: boolean) {
        if (!this.world.entities.has(this.world.myEntityId)) return

        // update mouse position to be instantaneous when we click
        this.onMouseMove(event)

        const myEntity = this.world.entities.get(
            this.world.myEntityId
        )! as Player

        const angle = myEntity.getAngleToMouse()

        this.sendInputAngle(angle)

        this.socket.streamWriter.writeU8(
            isDown ? ClientHeader.MOUSE_DOWN : ClientHeader.MOUSE_UP
        )

        this.socket.flush()
    }
}
