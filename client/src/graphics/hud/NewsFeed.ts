import * as PIXI from 'pixi.js'

class NewsMessage extends PIXI.Container {
    text: string
    constructor(text: string) {
        super()
        this.text = text

        // setup text box
        const txt = new PIXI.Text({
            text,
            style: new PIXI.TextStyle({
                fontFamily: 'Arial',
                fontSize: 18,
                fill: 0xffffff,
                align: 'left',
            }),
        })
        txt.anchor.set(0, 0)
        this.addChild(txt)
    }
}

export class NewsFeed extends PIXI.Container {
    messages: NewsMessage[] = []
    maxMessages: number = 5

    constructor() {
        super()
        this.position.set(0, 0)
    }

    addMessage(text: string): void {
        const message = new NewsMessage(text)
        this.messages.push(message)
        this.addChild(message)

        // Remove excess messages if we exceed the limit
        if (this.messages.length > this.maxMessages) {
            const excessMessages = this.messages.splice(
                0,
                this.messages.length - this.maxMessages
            )
            excessMessages.forEach((msg) => this.removeChild(msg))
        }

        // Update positions of all messages
        this.messages.forEach((msg, index) => {
            msg.y = index * 30
        })
    }

    update(_delta: number, _tick: number, _now: number): void {}

    resize(): void {
        const padding = 15

        this.position.set(padding, padding)
    }

    // TODO: add custom colors/styles to different message types
    addKillMessage(killer: string, victim: string, weapon?: string): void {
        let message = `${killer} eliminated ${victim}`
        if (weapon) {
            message += ` with ${weapon}`
        }
        this.addMessage(message)
    }

    addPlayerJoinMessage(playerName: string): void {
        this.addMessage(`${playerName} joined the game`)
    }

    addPlayerLeaveMessage(playerName: string): void {
        this.addMessage(`${playerName} left the game`)
    }

    addSystemMessage(message: string): void {
        this.addMessage(`[SYSTEM] ${message}`)
    }
}
