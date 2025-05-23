import { GameClient } from '../GameClient'
import { ClientHeader, PacketReader, PacketWriter } from '../packet'
import { isDevelopment } from '../utils/environment'
import { MessageHandler } from './MessageHandler'

export class Socket {
    private ws: WebSocket | null = null
    public streamReader: PacketReader = new PacketReader()
    public streamWriter: PacketWriter = new PacketWriter()
    private client: GameClient

    constructor(client: GameClient) {
        this.client = client
    }

    public connect(): void {
        if (this.isOpen()) {
            throw new Error(
                'SOCKET::CONNECT - Attempting to connect to the server while a connection has already been established'
            )
        }

        if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
            throw new Error(
                'SOCKET::CONNECT - Attempting to connect to the server while a connection is in progress'
            )
        }

        const url = isDevelopment()
            ? 'ws://localhost:9001'
            : location.href.replace('https', 'wss')
        this.ws = new WebSocket(url)
        this.ws.binaryType = 'arraybuffer'
        this.ws.onopen = this.onOpen.bind(this)
        this.ws.onclose = this.onClose.bind(this)
        this.ws.onmessage = this.onMessage.bind(this)
    }

    private onOpen(): void {
        this.streamWriter.writeU8(ClientHeader.SPAWN)
        this.streamWriter.writeString('Player')
        this.flush()
    }

    private onClose(): void {
        console.log('Socket closed')
    }

    private onMessage(msg: MessageEvent): void {
        const data = msg.data
        if (typeof data === 'string') {
            throw new Error(
                "Received string data from server, shouldn't happen"
            )
        }

        this.streamReader.loadBuffer(data)

        while (this.streamReader.getOffset() < this.streamReader.byteLength()) {
            MessageHandler.handle(this.streamReader, this.client)
        }
    }

    public isOpen(): boolean {
        return this.ws !== null && this.ws.readyState === WebSocket.OPEN
    }

    public flush(): void {
        if (this.isOpen() && this.streamWriter.hasData()) {
            this.ws!.send(this.streamWriter.getMessage())
            this.streamWriter.clear()
        }
    }
}
