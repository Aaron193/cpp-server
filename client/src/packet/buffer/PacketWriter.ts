interface IPacketWriter {
    writeU8(value: number): void;
    writeU16(value: number): void;
    writeU32(value: number): void;
    writeFloat(value: number): void;
    writeString(value: string): void;
    getMessage(): ArrayBuffer;
    clear(): void;
}

export class PacketWriter implements IPacketWriter {
    private buffer: ArrayBuffer;
    private view: DataView;
    private offset: number;

    constructor(size: number = 0xffff) {
        this.buffer = new ArrayBuffer(size);
        this.view = new DataView(this.buffer);
        this.offset = 0;
    }

    writeU8(value: number) {
        this.view.setUint8(this.offset, value);
        this.offset += 1;
    }

    writeU16(value: number) {
        this.view.setUint16(this.offset, value, true);
        this.offset += 2;
    }

    writeU32(value: number) {
        this.view.setUint32(this.offset, value, true);
        this.offset += 4;
    }

    writeFloat(value: number) {
        this.view.setFloat32(this.offset, value, true);
        this.offset += 4;
    }

    writeString(value: string) {
        const encoder = new TextEncoder();
        const encoded = encoder.encode(value);
        this.writeU16(encoded.length);
        new Uint8Array(this.buffer).set(encoded, this.offset);
        this.offset += encoded.length;
    }

    getMessage() {
        return this.buffer.slice(0, this.offset);
    }

    clear() {
        this.offset = 0;
    }

    hasData() {
        return this.offset > 0;
    }
}