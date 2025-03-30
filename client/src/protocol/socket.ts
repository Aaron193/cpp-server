import { PacketReader, PacketWriter } from "../packet";
import { isDevelopment } from "../utils/environment";
import { IMessage } from "./messages/IMessage";
import { MessageFactory } from "./messages/MessageFactory";


export class Socket {
    private ws: WebSocket | null = null;
    private streamReader: PacketReader = new PacketReader();
    private streamWriter: PacketWriter = new PacketWriter();


    public connect(): void {
        if (this.isOpen()) {
            throw new Error(
                'SOCKET::CONNECT - Attempting to connect to the server while a connection has already been established'
            );
        }

        if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
            throw new Error('SOCKET::CONNECT - Attempting to connect to the server while a connection is in progress');
        }

        const url = isDevelopment() ? 'ws://localhost:3000' : location.href.replace('https', 'wss');
        this.ws = new WebSocket(url);
        this.ws.binaryType = 'arraybuffer';
        this.ws.onopen = this.onOpen.bind(this);
        this.ws.onclose = this.onClose.bind(this);
        this.ws.onmessage = this.onMessage.bind(this);
    }

    private onOpen(): void {
        console.log('Socket opened');
    }

    private onClose(): void {
        console.log('Socket closed');
    }

    private onMessage(msg: MessageEvent): void {
        const data = msg.data;
        if (typeof data === 'string') {
            throw new Error("Received string data from server, shouldn't happen");
        }

        this.streamReader.loadBuffer(data);

        while (this.streamReader.getOffset() < this.streamReader.byteLength()) {
            const message: IMessage = MessageFactory.createMessage(this.streamReader);
            try {
                message.process();
            } catch(error) {
                throw new Error(`Error processing websocket message: ${error}`);
            }
        }
    }

    public isOpen(): boolean {
        return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
    }

    public flush(): void {
        if (this.isOpen()) {
            this.ws!.send(this.streamWriter.getMessage());
            this.streamWriter.clear();
        }
    }
}