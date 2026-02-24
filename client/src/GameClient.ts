import { Player } from './graphics/Player'
import { ClientHeader } from './packet'
import { Socket } from './protocol/Socket'
import { World } from './World'

export class GameClient {
    world: World
    socket: Socket
    lastSendDirection: number = 0
    currentDirection: number = 0

    mouseX: number = 0
    mouseY: number = 0
    lastSendAngle: number = 0

    private lastAngleSentTime: number = 0
    private lastSendMouseDown: boolean = false

    private constructor(world: World, host: string, port: number) {
        this.world = world
        this.socket = new Socket(this, host, port)
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

    public static async create(
        host: string,
        port: number
    ): Promise<GameClient> {
        const world = await World.create()
        return new GameClient(world, host, port)
    }

    update(delta: number, tick: number, now: number) {
        this.world.update(delta, tick, now)

        // socket event-triggered messages or whatever
        this.sendInputDirection(this.currentDirection)

        // get my player
        if (this.world.isControllingPlayer()) {
            const myEntity = this.world.entities.get(
                this.world.cameraEntityId
            )! as Player
            this.sendInputAngle(myEntity.getRot(), true)
        }

        this.socket.flush()
    }

    private sendInputDirection(direction: number) {
        if (!this.world.active) return

        if (this.lastSendDirection !== direction) {
            this.lastSendDirection = direction
            this.socket.streamWriter.writeU8(ClientHeader.MOVEMENT)
            this.socket.streamWriter.writeU8(direction)
        }
    }

    private sendInputAngle(angle: number, saveBandwidth: boolean = false) {
        if (!this.world.active) return

        let angleTolerance = 0.01 // radians
        let throttleTime = 100 // milliseconds

        // reduce tolerance and throttle if our mouse is down
        // this allows more accurate aiming
        if (this.lastSendMouseDown) {
            angleTolerance = 0.001
            throttleTime = 16
        }

        const now = Date.now()

        // Save bandwidth by not sending the same angle repeatedly
        if (
            saveBandwidth &&
            Math.abs(this.lastSendAngle - angle) < angleTolerance
        ) {
            return
        }

        // Throttle message to send at interval
        if (saveBandwidth && now - this.lastAngleSentTime < throttleTime) {
            return
        }

        this.lastSendAngle = angle
        this.lastAngleSentTime = now
        this.socket.streamWriter.writeU8(ClientHeader.MOUSE)
        this.socket.streamWriter.writeFloat(angle)
    }

    private isChatOpen(): boolean {
        const chat = document.getElementById('chat_input') as HTMLInputElement
        return chat && !chat.classList.contains('hidden')
    }

    private onKeyDown(event: KeyboardEvent) {
        if (!this.isChatOpen())
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
                case 'm': {
                    const minimap = this.world.renderer.hud.minimap
                    minimap.toggleExpanded()
                    break
                }
                case 'r':
                case 'R': {
                    if (this.world.isControllingPlayer()) {
                        this.socket.streamWriter.writeU8(ClientHeader.RELOAD)
                        this.socket.flush()
                    }
                    break
                }
                case 'e':
                case 'E': {
                    if (this.world.isControllingPlayer()) {
                        this.socket.streamWriter.writeU8(
                            ClientHeader.PICKUP_REQUEST
                        )
                        this.socket.flush()
                    }
                    break
                }
                case '1':
                case '2':
                case '3':
                case '4':
                case '5': {
                    if (this.world.isControllingPlayer()) {
                        const slot = Number(event.key) - 1
                        this.socket.streamWriter.writeU8(
                            ClientHeader.SWITCH_ITEM
                        )
                        this.socket.streamWriter.writeU8(slot)
                        this.socket.flush()
                    }
                    break
                }
            }
    }

    private onKeyUp(event: KeyboardEvent) {
        if (!this.isChatOpen())
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
                case 'Enter': {
                    const chat = document.getElementById(
                        'chat_input'
                    ) as HTMLInputElement

                    chat.classList.remove('hidden')
                    chat.focus()
                }
            }
        else
            switch (event.key) {
                case 'Enter': {
                    console.log('pressed enter')
                    const chat = document.getElementById(
                        'chat_input'
                    ) as HTMLInputElement

                    chat.classList.add('hidden')
                    chat.blur()

                    const message = chat.value.trim()
                    if (message.length > 0 && message.length <= 50) {
                        this.socket.streamWriter.writeU8(
                            ClientHeader.CLIENT_CHAT
                        )
                        this.socket.streamWriter.writeString(message)
                    }

                    chat.value = ''
                    break
                }
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
        if (!this.world.isControllingPlayer()) return

        // update mouse position to be instantaneous when we click
        this.onMouseMove(event)

        // we are active, so we're controlling our player
        const myEntity = this.world.entities.get(
            this.world.cameraEntityId
        )! as Player

        const angle = myEntity.getAngleToMouse()

        this.sendInputAngle(angle)

        this.lastSendMouseDown = isDown

        this.socket.streamWriter.writeU8(
            isDown ? ClientHeader.MOUSE_DOWN : ClientHeader.MOUSE_UP
        )

        this.socket.flush()
    }
}
