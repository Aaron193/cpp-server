import { ChatChannel, LIMITS, MatchPhase, Weapon, type Chat, type Damage, type Death, type EntityRecord, type Impact, type MatchState, type Respawn, type RoundTransition, type ScoreChange, type ShotConfirmed, type Snapshot } from '../../protocol/generated'
import { RingBuffer } from '../performance/RingBuffer'

export interface LocalCombatState {
    readonly playerId: number | null
    readonly health: number | null
    readonly weapon: Weapon
    readonly magazineAmmo: number
    readonly reserveAmmo: number
    readonly reloading: boolean
    readonly dead: boolean
}
export interface ScoreRow { readonly playerId: number; readonly score: number; readonly kills: number; readonly deaths: number }
export interface KillFeedRow { readonly serverTick: number; readonly victimId: number; readonly killerId: number | null; readonly weapon: Weapon }
export interface ChatRow { readonly senderId: number | null; readonly channel: ChatChannel; readonly text: string }
export type CombatEvent =
    | { readonly id: number; readonly kind: 'local-fire'; readonly sequence: number; readonly weapon: Weapon }
    | { readonly id: number; readonly kind: 'shot'; readonly value: ShotConfirmed; readonly correlated: boolean }
    | { readonly id: number; readonly kind: 'impact'; readonly value: Impact }
    | { readonly id: number; readonly kind: 'damage'; readonly value: Damage; readonly localHit: boolean; readonly localDamage: boolean }
    | { readonly id: number; readonly kind: 'death'; readonly value: Death }
    | { readonly id: number; readonly kind: 'respawn'; readonly value: Respawn }
    | { readonly id: number; readonly kind: 'round'; readonly value: RoundTransition }
    | { readonly id: number; readonly kind: 'chat'; readonly value: Chat }
type CombatEventInput = CombatEvent extends infer Event ? Event extends unknown ? Omit<Event, 'id'> : never : never

const DEFAULT_MATCH: MatchState = { phase: MatchPhase.Waiting, roundNumber: 0, phaseEndsAtTick: 0 }

export class CombatPresentationState {
    private local: LocalCombatState = { playerId: null, health: null, weapon: Weapon.None, magazineAmmo: 0, reserveAmmo: 0, reloading: false, dead: false }
    private readonly scoreMap = new Map<number, ScoreRow>()
    private readonly feed = new RingBuffer<KillFeedRow>(8)
    private readonly messages = new RingBuffer<ChatRow>(50)
    private readonly eventQueue = new RingBuffer<CombatEvent>(128)
    private pendingShots = new Set<number>()
    private eventId = 0
    private currentMatch: MatchState = DEFAULT_MATCH
    readonly maxScores = 64
    readonly maxFeed = 8
    readonly maxChat = 50
    readonly maxEvents = 128
    scoreRevision = 0
    feedRevision = 0
    chatRevision = 0

    setPlayerId(playerId: number): void { this.local = { ...this.local, playerId } }
    acceptSnapshot(snapshot: Snapshot): void {
        this.currentMatch = snapshot.match
        const entity = snapshot.entities.find((value) => value.entityId === this.local.playerId)
        if (!entity) return
        this.acceptLocalEntity(entity)
    }
    private acceptLocalEntity(entity: EntityRecord): void {
        const weapon = entity.weaponState
        this.local = {
            playerId: this.local.playerId,
            health: entity.health,
            weapon: entity.equippedWeapon,
            magazineAmmo: weapon?.magazineAmmo ?? 0,
            reserveAmmo: weapon?.reserveAmmo ?? 0,
            reloading: Boolean((weapon?.stateFlags ?? 0) & 1),
            dead: Boolean(entity.stateFlags & 1),
        }
    }
    localFire(sequence: number, weapon: Weapon): void {
        this.pendingShots.add(sequence >>> 0)
        if (this.pendingShots.size > 64) this.pendingShots.delete(this.pendingShots.values().next().value!)
        this.push({ kind: 'local-fire', sequence, weapon })
    }
    shot(value: ShotConfirmed): void {
        const correlated = value.shooterId === this.local.playerId && this.pendingShots.delete(value.inputSequence)
        this.push({ kind: 'shot', value, correlated })
    }
    impact(value: Impact): void { this.push({ kind: 'impact', value }) }
    damage(value: Damage): void { this.push({ kind: 'damage', value, localHit: value.sourceId === this.local.playerId, localDamage: value.targetId === this.local.playerId }) }
    death(value: Death): void {
        this.feed.push({ serverTick: value.serverTick, victimId: value.victimId, killerId: value.killerId, weapon: value.weapon })
        this.feedRevision++
        this.push({ kind: 'death', value })
    }
    respawn(value: Respawn): void { this.push({ kind: 'respawn', value }) }
    score(value: ScoreChange): void {
        if (!this.scoreMap.has(value.playerId) && this.scoreMap.size >= this.maxScores) this.scoreMap.delete(this.scoreMap.keys().next().value!)
        this.scoreMap.set(value.playerId, { playerId: value.playerId, score: value.score, kills: value.kills, deaths: value.deaths })
        this.scoreRevision++
    }
    round(value: RoundTransition): void { this.currentMatch = value.match; this.push({ kind: 'round', value }) }
    chat(value: Chat): void {
        this.messages.push(value)
        this.chatRevision++
        this.push({ kind: 'chat', value })
    }
    validateChat(text: string): string {
        const clean = text.trim()
        if (!clean) throw new Error('Chat message is empty')
        if (new TextEncoder().encode(clean).length > LIMITS.maxChatBytes) throw new Error('Chat message is too long')
        return clean
    }
    /** Compatibility snapshot for tests/tools; frame loops should use forEachEventAfter. */
    eventsAfter(id: number): readonly CombatEvent[] { return this.eventQueue.toArray().filter((event) => event.id > id) }
    forEachEventAfter(id: number, visitor: (event: CombatEvent) => void): void { this.eventQueue.forEach((event) => { if (event.id > id) visitor(event) }) }
    forEachScore(visitor: (row: ScoreRow) => void): void { for (const row of this.scores) visitor(row) }
    forEachKillFeed(visitor: (row: KillFeedRow) => void): void { this.feed.forEach(visitor) }
    forEachChatMessage(visitor: (row: ChatRow) => void): void { this.messages.forEach(visitor) }
    get localPlayer(): LocalCombatState { return this.local }
    get scores(): readonly ScoreRow[] { return [...this.scoreMap.values()].sort((a, b) => b.score - a.score || a.playerId - b.playerId) }
    get killFeed(): readonly KillFeedRow[] { return this.feed.toArray() }
    get chatMessages(): readonly ChatRow[] { return this.messages.toArray() }
    get match(): MatchState { return this.currentMatch }
    get lastEventId(): number { return this.eventId }
    clear(): void {
        this.local = { playerId: null, health: null, weapon: Weapon.None, magazineAmmo: 0, reserveAmmo: 0, reloading: false, dead: false }
        this.scoreMap.clear(); this.feed.clear(); this.messages.clear(); this.eventQueue.clear(); this.pendingShots.clear(); this.currentMatch = DEFAULT_MATCH; this.eventId = 0
        this.scoreRevision++; this.feedRevision++; this.chatRevision++
    }
    private push(event: CombatEventInput): void {
        this.eventQueue.push({ ...event, id: ++this.eventId } as CombatEvent)
    }
}

export function alignClientTick(previous: number, serverTick: number): number {
    const candidate = serverTick >>> 0
    const distance = (candidate - (previous >>> 0)) >>> 0
    return previous === 0 || (distance !== 0 && distance < 0x80000000) ? candidate : ((previous + 1) >>> 0)
}
