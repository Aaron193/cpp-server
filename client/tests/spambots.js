const WebSocket = require('ws')

let botCounter = 0
let activeConnections = 0
const maxConcurrentConnections = 500
const totalBotsCreated = { count: 0 }

function createBot() {
    if (activeConnections >= maxConcurrentConnections) {
        return
    }

    const botId = ++botCounter
    const ws = new WebSocket('ws://localhost:9001')

    console.log(
        `[Bot ${botId}] Connecting... (Active: ${activeConnections + 1})`
    )
    activeConnections++
    totalBotsCreated.count++

    ws.onopen = function () {
        console.log(`[Bot ${botId}] Connected! Spawning player...`)

        // Send spawn packet
        ws.send(
            new Uint8Array([
                0x00, 0x08, 0x00, 0x6d, 0x79, 0x20, 0x6e, 0x61, 0x6d, 0x65,
                0x21,
            ])
        )

        // Send movement packets
        const movementInterval = setInterval(
            () => {
                if (ws.readyState === WebSocket.OPEN) {
                    const randomMovement = Math.floor(Math.random() * 256)
                    ws.send(new Uint8Array([2, randomMovement]))
                    console.log(
                        `[Bot ${botId}] Sent movement: ${randomMovement}`
                    )
                } else {
                    clearInterval(movementInterval)
                }
            },
            50 + Math.random() * 100
        )

        // Spam server with random packets
        const randomDataInterval = setInterval(
            () => {
                if (ws.readyState === WebSocket.OPEN) {
                    const packetSize = Math.floor(Math.random() * 10) + 1
                    const randomPacket = new Uint8Array(packetSize)

                    for (let i = 0; i < packetSize; i++) {
                        randomPacket[i] = Math.floor(Math.random() * 256)
                    }

                    ws.send(randomPacket)
                    console.log(
                        `[Bot ${botId}] Sent random data: [${Array.from(randomPacket).join(', ')}]`
                    )
                } else {
                    clearInterval(randomDataInterval)
                }
            },
            80 + Math.random() * 120
        )

        const disconnectTime = Math.random() * 2500 + 500

        setTimeout(() => {
            if (ws.readyState === WebSocket.OPEN) {
                console.log(
                    `[Bot ${botId}] Disconnecting after ${disconnectTime.toFixed(0)}ms`
                )
                clearInterval(movementInterval)
                clearInterval(randomDataInterval)
                ws.close()
            }
        }, disconnectTime)
    }

    ws.onclose = function () {
        console.log(
            `[Bot ${botId}] Disconnected (Active: ${activeConnections - 1})`
        )
        activeConnections--
    }

    ws.onerror = function (error) {
        console.log(`[Bot ${botId}] Error:`, error.message)
        activeConnections--
    }
}

function startContinuousTest() {
    console.log('Starting continuous bot stress test...')
    console.log(`Max concurrent connections: ${maxConcurrentConnections}`)

    for (let i = 0; i < maxConcurrentConnections; i++) {
        setTimeout(() => createBot(), i * 10)
    }

    setInterval(() => {
        const botsToCreate = Math.min(
            5,
            maxConcurrentConnections - activeConnections
        )
        for (let i = 0; i < botsToCreate; i++) {
            setTimeout(() => createBot(), i * 20)
        }
    }, 100)

    setInterval(() => {
        console.log(
            `--- Status: ${activeConnections} active, ${totalBotsCreated.count} total created ---`
        )
    }, 2000)
}

startContinuousTest()

process.on('SIGINT', () => {
    console.log('\nShutting down bot test...')
    console.log(`Total bots created: ${totalBotsCreated.count}`)
    process.exit(0)
})
