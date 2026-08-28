import { z } from 'zod'

export const serverRegistrationSchema = z.object({
    id: z.string().trim().min(1).max(128),
    host: z.string().trim().min(1).max(253),
    port: z.number().int().positive().max(65535),
    region: z.string().trim().min(1).max(64),
    maxPlayers: z.number().int().positive().max(512),
    buildId: z.string().trim().min(1).max(64),
    protocolVersion: z.number().int().positive().max(65535),
    mapId: z.string().trim().min(1).max(64),
    mapFormatVersion: z.number().int().min(1).max(65535),
    mapContentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    mode: z.string().trim().min(1).max(64),
    websocketUrl: z.string().url().refine((value) => {
        const protocol = new URL(value).protocol
        return protocol === 'ws:' || protocol === 'wss:'
    }, 'websocketUrl must use ws:// or wss://'),
})
