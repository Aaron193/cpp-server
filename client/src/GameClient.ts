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
        this.world.renderer.canvas.addEventListener('mousemove', (event) =>
            this.onMouseMove(event)
        )
    }

    public static async create(): Promise<GameClient> {
        const world = await World.create()
        return new GameClient(world)
    }

    update(delta: number, tick: number, now: number) {
        this.world.update(delta, tick, now)

        // socket event-triggered messages or whatever
        if (this.lastSendDirection !== this.currentDirection) {
            this.lastSendDirection = this.currentDirection
            this.socket.streamWriter.writeU8(ClientHeader.MOVEMENT)
            this.socket.streamWriter.writeU8(this.currentDirection)
        }

        // get my player
        if (this.world.entities.has(this.world.myEntityId)) {
            const myEntity = this.world.entities.get(
                this.world.myEntityId
            )! as Player

            const angle = myEntity.body.rotation
            if (angle !== this.lastSendAngle) {
                this.lastSendAngle = angle
                this.socket.streamWriter.writeU8(ClientHeader.MOUSE)
                this.socket.streamWriter.writeFloat(angle)
            }
        }

        this.socket.flush()
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
}
