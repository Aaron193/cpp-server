import { ClientHeader } from './packet'
import { Socket } from './protocol/socket'
import { World } from './World'

export class GameClient {
    world: World
    socket: Socket = new Socket(this)
    lastSendDirection: number = 0
    currentDirection: number = 0

    private constructor(world: World) {
        this.world = world
        this.socket.connect()

        // keyboard
        window.addEventListener('keydown', (event) => this.onKeyDown(event))
        window.addEventListener('keyup', (event) => this.onKeyUp(event))
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
            this.socket.flush()
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
}
