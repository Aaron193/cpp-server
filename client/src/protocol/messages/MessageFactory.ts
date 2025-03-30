import { PacketReader, ServerHeader } from "../../packet";
import { IMessage } from "./IMessage"
import { SpawnSuccessMessage } from "./messages";

export class MessageFactory {
    static createMessage(reader: PacketReader): IMessage {
        const messageType = reader.readU8();

        switch (messageType) {
            case ServerHeader.SPAWN_SUCCESS: {
                const entity = reader.readU32();
                return new SpawnSuccessMessage(entity);
            }
            default:
                throw new Error(`Unknown message type: ${messageType}`);
        }
    }
}