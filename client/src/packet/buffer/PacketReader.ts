interface IPacketReader {
    loadBuffer(buffer: ArrayBuffer): void;
    readU8(): number;
    readU16(): number;
    readU32(): number;
    readFloat(): number;
    readString(): string;
    getOffset(): number;
    byteLength(): number;
}

export class PacketReader implements IPacketReader {
    // typescript wants default values here
    private buffer: ArrayBuffer = new ArrayBuffer(0);
    private view: DataView = new DataView(new ArrayBuffer(0));
    private offset: number = 0;

    loadBuffer(buffer: ArrayBuffer) {
        this.buffer = buffer;
        this.view = new DataView(buffer);
        this.offset = 0;
    }

    readU8(): number {
        const value = this.view.getUint8(this.offset);
        this.offset += 1;
        return value;
    }

    readU16(): number {
        const value = this.view.getUint16(this.offset, true);
        this.offset += 2;
        return value;
    }

    readU32(): number {
        const value = this.view.getUint32(this.offset, true);
        this.offset += 4;
        return value;
    }

    readFloat(): number {
        const value = this.view.getFloat32(this.offset, true);
        this.offset += 4;
        return value;
    }

    readString(): string {
        const length = this.readU16();
        const value = new TextDecoder().decode(this.buffer.slice(this.offset, this.offset + length));
        this.offset += length;
        return value;
    }

    getOffset() {
        return this.offset;
    }

    byteLength() {
        return this.buffer.byteLength;
    }
}