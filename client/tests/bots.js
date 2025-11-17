const count = 100
for (let i = 0; i < count; i++) {
    const ws = new WebSocket('ws://localhost:9001')
    ws.onopen = function () {
        ws.send(
            new Uint8Array([
                0x00, 0x08, 0x00, 0x6d, 0x79, 0x20, 0x6e, 0x61, 0x6d, 0x65,
                0x21,
            ])
        )

        console.log(`Bot ${i} connected`)
        // setTimeout(() => {
        //     ws.close()
        // }, Math.random() * 50)
    }
}
