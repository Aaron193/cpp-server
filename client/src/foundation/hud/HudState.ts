import type { ConnectionStatus } from '../networking/NetworkingModule'
import type { KillcamState } from '../replay/KillcamModule'
import { MatchPhase } from '../../protocol/generated'

export type HudState = 'connecting' | 'mismatch' | 'active' | 'damage' | 'reload' | 'intermission' | 'death' | 'killcam' | 'spectate' | 'reconnect' | 'rejection'
export function deriveHudStates(input: { readonly connection: ConnectionStatus; readonly detail?: string; readonly phase: MatchPhase; readonly dead: boolean; readonly reloading: boolean; readonly damaged: boolean; readonly replay: KillcamState }): readonly HudState[] {
    const states = new Set<HudState>()
    if (input.connection === 'connecting' || input.connection === 'handshaking') states.add('connecting')
    else if (input.connection === 'reconnecting' || input.connection === 'disconnected') states.add('reconnect')
    else if (input.connection === 'rejected') { states.add('rejection'); if (/map|build|version|protocol|mismatch/i.test(input.detail ?? '')) states.add('mismatch') }
    else if (input.connection === 'connected' || input.connection === 'offline') states.add('active')
    if (input.phase === MatchPhase.Intermission || input.phase === MatchPhase.Ended) states.add('intermission')
    if (input.dead) states.add('death')
    if (input.reloading) states.add('reload')
    if (input.damaged) states.add('damage')
    if (input.replay === 'killcam') states.add('killcam')
    if (input.replay === 'spectator') states.add('spectate')
    return [...states]
}
