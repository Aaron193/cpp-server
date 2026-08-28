import { describe, expect, it } from 'vitest'
import { ChatChannel, ImpactMaterial, MatchPhase, RoundTransitionKind, Weapon, type LocalAuthoritativeState } from '../src/protocol/generated'
import { CombatPresentationState, alignClientTick } from '../src/foundation/combat/CombatState'

const local = (health: number, ammo = 10): LocalAuthoritativeState => ({ handle: { slot: 7, generation: 0 }, position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, bodyYaw: 0, aimPitch: 0, grounded: true, stateFlags: 0, health, weaponState: { selected: Weapon.Shotgun, magazineAmmo: ammo, reserveAmmo: 20, stateFlags: 1 } })
const match = { phase: MatchPhase.Active, roundNumber: 2, phaseEndsAtTick: 700 }

describe('authoritative combat presentation model', () => {
    it('updates local HUD values only from authoritative snapshots', () => {
        const state = new CombatPresentationState(); state.setPlayerId(7); state.acceptAuthoritative(local(83, 4), match)
        expect(state.localPlayer).toMatchObject({ health: 83, weapon: Weapon.Shotgun, magazineAmmo: 4, reserveAmmo: 20, reloading: true })
        state.damage({ serverTick: 101, sourceId: 9, targetId: 7, amount: 50, remainingHealth: 33 })
        expect(state.localPlayer.health).toBe(83)
        state.localFire(2, Weapon.Shotgun)
        expect(state.localPlayer.magazineAmmo).toBe(4)
        state.acceptAuthoritative(local(33, 4), match); expect(state.localPlayer.health).toBe(33)
    })
    it('only predicts local shots for the equipped, loaded weapon', () => {
        const state = new CombatPresentationState(); state.setPlayerId(7)
        state.acceptAuthoritative(local(83, 0), match)
        expect(state.canLocalFire(Weapon.Shotgun)).toBe(false)
        state.acceptAuthoritative(local(83, 1), match)
        expect(state.canLocalFire(Weapon.Rifle)).toBe(false)
        expect(state.canLocalFire(Weapon.Shotgun)).toBe(false) // Reloading.
        state.acceptAuthoritative({ ...local(83, 1), weaponState: { ...local(83, 1).weaponState, stateFlags: 0 } }, match)
        expect(state.canLocalFire(Weapon.Shotgun)).toBe(true)
    })
    it('routes correlations, scores, rounds, feed, chat and clears all bounded state', () => {
        const state = new CombatPresentationState(); state.setPlayerId(7); state.localFire(9, Weapon.Rifle)
        state.shot({ serverTick: 1, shooterId: 7, inputSequence: 9, actionId: 9, shotId: 4, weapon: Weapon.Rifle })
        expect(state.eventsAfter(0).find((event) => event.kind === 'shot')).toMatchObject({ correlated: true })
        state.shot({ serverTick: 2, shooterId: 8, inputSequence: 9, actionId: 9, shotId: 5, weapon: Weapon.Rifle })
        expect(state.eventsAfter(0).filter((event) => event.kind === 'shot')[1]).toMatchObject({ correlated: false })
        state.damage({ serverTick: 2, sourceId: 8, targetId: 9, amount: 1, remainingHealth: 99 })
        expect(state.eventsAfter(0).find((event) => event.kind === 'damage')).toMatchObject({ localHit: false, localDamage: false })
        for (let id = 0; id < 70; id++) state.score({ serverTick: id, playerId: id, score: id, delta: 1, kills: id, deaths: 0 })
        expect(state.scores).toHaveLength(state.maxScores)
        for (let id = 0; id < 12; id++) state.death({ serverTick: id, victimId: id, killerId: 7, weapon: Weapon.Rifle })
        expect(state.killFeed).toHaveLength(state.maxFeed)
        state.round({ serverTick: 4, transition: RoundTransitionKind.Intermission, match: { phase: MatchPhase.Intermission, roundNumber: 2, phaseEndsAtTick: 500 } })
        state.chat({ senderId: 7, channel: ChatChannel.Global, text: 'hello' })
        expect(state.match.phase).toBe(MatchPhase.Intermission); expect(state.chatMessages[0]?.text).toBe('hello')
        for (let id = 0; id < 200; id++) state.impact({ serverTick: id, shotId: id, position: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 }, material: ImpactMaterial.World })
        expect(state.eventsAfter(0)).toHaveLength(state.maxEvents)
        state.clear(); expect(state.scores).toEqual([]); expect(state.killFeed).toEqual([]); expect(state.chatMessages).toEqual([]); expect(state.localPlayer.playerId).toBeNull()
    })
    it('validates chat and aligns ticks monotonically across wrap', () => {
        const state = new CombatPresentationState()
        expect(state.validateChat('  hi  ')).toBe('hi'); expect(() => state.validateChat('   ')).toThrow(/empty/)
        expect(alignClientTick(10, 1000)).toBe(1000)
        expect(alignClientTick(0xfffffffe, 1)).toBe(1)
        expect(alignClientTick(1000, 900)).toBe(1001)
    })
})
