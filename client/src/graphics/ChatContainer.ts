import * as PIXI from 'pixi.js'
import { ChatBubble } from './ChatBubble'
import { Animation, LinearInOut } from './utils/Animation'

interface ChatMessage {
    text: string
    animation: Animation
    bubble: ChatBubble
    targetY: number
    currentY: number
}

export class ChatContainer extends PIXI.Container {
    private messages: ChatMessage[] = []
    private maxMessages: number = 2
    private bubbleSpacing: number = 35

    constructor() {
        super()
    }

    addMessage(text: string) {
        // Remove old messages
        if (this.messages.length >= this.maxMessages) {
            const old = this.messages.pop()!
            this.removeChild(old.bubble)
            old.bubble.destroy()
        }

        const bubble = new ChatBubble()
        const animation = new Animation(
            (t) => 1 - (2 * t - 1) ** 6,
            4, // seconds
            1
        )

        const message: ChatMessage = {
            text,
            animation,
            bubble,
            targetY: 0,
            currentY: 0,
        }

        this.messages.unshift(message)
        this.addChild(bubble)

        this.updatePositions()

        bubble.setMessage(text, 1)
        bubble.position.set(0, message.currentY)
        bubble.show()
    }

    private updatePositions() {
        this.messages.forEach((message, index) => {
            message.targetY = -index * this.bubbleSpacing
        })
    }

    update(delta: number) {
        const removals: ChatMessage[] = []

        this.messages.forEach((message) => {
            const isFinished = message.animation.update(delta)
            const opacity = message.animation.current

            const positionDiff = message.targetY - message.currentY
            if (Math.abs(positionDiff) > 0.1) {
                message.currentY += positionDiff * delta * 8
                message.bubble.position.y = message.currentY
            } else {
                message.currentY = message.targetY
                message.bubble.position.y = message.currentY
            }

            message.bubble.setMessage(message.text, opacity)

            if (isFinished) {
                removals.push(message)
            }
        })

        // clear finished messages
        removals.forEach((message) => {
            const index = this.messages.indexOf(message)
            if (index > -1) {
                this.messages.splice(index, 1)
                this.removeChild(message.bubble)
                message.bubble.destroy()
            }
        })

        if (removals.length > 0) {
            this.updatePositions()
        }

        this.visible = this.messages.length > 0
    }

    hasMessages(): boolean {
        return this.messages.length > 0
    }

    getMessageCount(): number {
        return this.messages.length
    }
}
