import { GameClient } from '../GameClient'
import { ClientHeader, PacketReader, PacketWriter } from '../packet'
import { assert } from '../utils/assert'
import { isDevelopment } from '../utils/environment'
import { getAccessToken } from '../utils/cookies'
import { MessageHandler } from './MessageHandler'

export class Socket {
    private ws: WebSocket | null = null
    public streamReader: PacketReader = new PacketReader()
    public streamWriter: PacketWriter = new PacketWriter()
    private client: GameClient
    private host: string
    private port: number

    constructor(client: GameClient, host: string, port: number) {
        this.client = client
        this.host = host
        this.port = port
    }

    public connect(): void {
        if (this.isOpen()) {
            assert(
                false,
                'SOCKET::CONNECT - Attempting to connect to the server while a connection has already been established'
            )
        }

        if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
            assert(
                false,
                'SOCKET::CONNECT - Attempting to connect to the server while a connection is in progress'
            )
        }

        const url = `ws://${this.host}:${this.port}`
        console.log(`Connecting to WebSocket: ${url}`)
        this.ws = new WebSocket(url)
        this.ws.binaryType = 'arraybuffer'
        this.ws.onopen = this.onOpen.bind(this)
        this.ws.onclose = this.onClose.bind(this)
        this.ws.onmessage = this.onMessage.bind(this)
    }

    private onOpen(): void {
        console.log('WebSocket connected')

        // Get access token if available
        const token = getAccessToken()

        // Send SPAWN message with player name
        // TODO: If token exists, send it to server for authentication
        // For now, we'll send the username from the token or use a default
        this.streamWriter.writeU8(ClientHeader.SPAWN)
        this.streamWriter.writeString('my name!')
        this.flush()

        if (token) {
            console.log('User authenticated with access token')
        } else {
            console.log('No authentication token found, connecting as guest')
        }
    }

    private onClose(): void {
        console.log('Socket closed')
    }

    private onMessage(msg: MessageEvent): void {
        const data = msg.data
        if (typeof data === 'string') {
            assert(false, "Received string data from server, shouldn't happen")
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
