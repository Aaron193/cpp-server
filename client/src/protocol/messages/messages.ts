import { IMessage } from './IMessage'

export class SpawnSuccessMessage implements IMessage {
    constructor(private entity: number) {}

    process(): void {
        console.log(`Processing spawn success: ${this.entity}`)
    }
}
