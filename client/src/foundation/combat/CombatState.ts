import { ActionKind, ChatChannel, LIMITS, MatchPhase, Weapon, type ActionResult, type Chat, type Damage, type Death, type Impact, type LocalAuthoritativeState, type MatchState, type Respawn, type RoundTransition, type ScoreChange, type ShotConfirmed, type Snapshot, type Vec3 } from '../../protocol/generated'
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
    | { readonly id: number; readonly kind: 'local-fire'; readonly actionId: number; readonly sequence: number; readonly weapon: Weapon }
    | { readonly id: number; readonly kind: 'local-reload'; readonly actionId: number; readonly sequence: number; readonly weapon: Weapon }
    | { readonly id: number; readonly kind: 'action-result'; readonly value: ActionResult; readonly latencyMs: number }
    | { readonly id: number; readonly kind: 'action-timeout'; readonly actionId: number; readonly actionKind: ActionKind; readonly weapon: Weapon }
    | { readonly id: number; readonly kind: 'predicted-contact'; readonly actionId: number; readonly position: Vec3 }
    | { readonly id: number; readonly kind: 'shot'; readonly value: ShotConfirmed; readonly correlated: boolean }
    | { readonly id: number; readonly kind: 'impact'; readonly value: Impact }
    | { readonly id: number; readonly kind: 'damage'; readonly value: Damage; readonly localHit: boolean; readonly localDamage: boolean }
    | { readonly id: number; readonly kind: 'death'; readonly value: Death }
    | { readonly id: number; readonly kind: 'respawn'; readonly value: Respawn }
    | { readonly id: number; readonly kind: 'round'; readonly value: RoundTransition }
    | { readonly id: number; readonly kind: 'chat'; readonly value: Chat }
type CombatEventInput = CombatEvent extends infer Event ? Event extends unknown ? Omit<Event, 'id'> : never : never
interface PendingAction { readonly actionId: number; readonly kind: ActionKind; readonly sequence: number; readonly weapon: Weapon; readonly startedAtMs: number }

const DEFAULT_MATCH: MatchState = { phase: MatchPhase.Waiting, roundNumber: 0, phaseEndsAtTick: 0 }

export class CombatPresentationState {
    private local: LocalCombatState = { playerId: null, health: null, weapon: Weapon.None, magazineAmmo: 0, reserveAmmo: 0, reloading: false, dead: false }
    private readonly scoreMap = new Map<number, ScoreRow>()
    private readonly feed = new RingBuffer<KillFeedRow>(8)
    private readonly messages = new RingBuffer<ChatRow>(50)
    private readonly eventQueue = new RingBuffer<CombatEvent>(128)
    private readonly pendingActions = new Map<number, PendingAction>()
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
    }
    acceptAuthoritative(local: LocalAuthoritativeState, match: MatchState | null): void {
        if (match) this.currentMatch = match
        this.local = {
            playerId: this.local.playerId,
            health: local.health,
            weapon: local.weaponState.selected,
            magazineAmmo: local.weaponState.magazineAmmo,
            reserveAmmo: local.weaponState.reserveAmmo,
            reloading: Boolean(local.weaponState.stateFlags & 1),
            dead: Boolean(local.stateFlags & 1),
        }
    }
    localFire(actionId: number, sequence: number, weapon: Weapon, nowMs?: number): void
    localFire(actionId: number, weapon: Weapon): void
    localFire(actionId: number, sequenceOrWeapon: number | Weapon, weapon?: Weapon, nowMs = performance.now()): void {
        const sequence = weapon === undefined ? actionId : sequenceOrWeapon
        const selected = weapon === undefined ? sequenceOrWeapon as Weapon : weapon
        this.addAction({ actionId: actionId >>> 0, kind: ActionKind.Fire, sequence: sequence >>> 0, weapon: selected, startedAtMs: nowMs })
        this.push({ kind: 'local-fire', actionId: actionId >>> 0, sequence: sequence >>> 0, weapon: selected })
    }
    localReload(actionId: number, sequence: number, weapon: Weapon, nowMs = performance.now()): void { this.addAction({ actionId: actionId >>> 0, kind: ActionKind.Reload, sequence: sequence >>> 0, weapon, startedAtMs: nowMs }); this.push({ kind: 'local-reload', actionId: actionId >>> 0, sequence: sequence >>> 0, weapon }) }
    canLocalFire(weapon: Weapon): boolean {
        return !this.local.dead && !this.local.reloading &&
            this.local.weapon === weapon && this.local.magazineAmmo > 0
    }
    shot(value: ShotConfirmed): void {
        const correlated = value.shooterId === this.local.playerId && this.pendingActions.has(value.actionId)
        this.push({ kind: 'shot', value, correlated })
    }
    actionResult(value: ActionResult, nowMs = performance.now()): void { const pending = this.pendingActions.get(value.actionId); if (pending && pending.kind === value.kind) this.pendingActions.delete(value.actionId); this.push({ kind: 'action-result', value, latencyMs: pending ? Math.max(0, nowMs - pending.startedAtMs) : 0 }) }
    predictedContact(actionId: number, position: Vec3): void { if (this.pendingActions.has(actionId)) this.push({ kind: 'predicted-contact', actionId, position }) }
    expireActions(nowMs = performance.now(), timeoutMs = 1500): number { let expired = 0; for (const [id, pending] of this.pendingActions) if (nowMs - pending.startedAtMs >= timeoutMs) { this.pendingActions.delete(id); this.push({ kind: 'action-timeout', actionId: id, actionKind: pending.kind, weapon: pending.weapon }); expired++ } return expired }
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
        this.scoreMap.clear(); this.feed.clear(); this.messages.clear(); this.eventQueue.clear(); this.pendingActions.clear(); this.currentMatch = DEFAULT_MATCH; this.eventId = 0
        this.scoreRevision++; this.feedRevision++; this.chatRevision++
    }
    private push(event: CombatEventInput): void {
        this.eventQueue.push({ ...event, id: ++this.eventId } as CombatEvent)
    }
    private addAction(action: PendingAction): void { if (action.actionId === 0) throw new RangeError('Action id zero is reserved'); if (this.pendingActions.has(action.actionId)) throw new Error(`Duplicate action id ${action.actionId}`); if (this.pendingActions.size >= 64) { const oldest = this.pendingActions.keys().next().value; if (oldest !== undefined) this.pendingActions.delete(oldest) } this.pendingActions.set(action.actionId, action) }
    get pendingActionCount(): number { return this.pendingActions.size }
}

export function alignClientTick(previous: number, serverTick: number): number {
    const candidate = serverTick >>> 0
    const distance = (candidate - (previous >>> 0)) >>> 0
    return previous === 0 || (distance !== 0 && distance < 0x80000000) ? candidate : ((previous + 1) >>> 0)
}
