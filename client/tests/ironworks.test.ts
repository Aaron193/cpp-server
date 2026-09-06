import { describe, it, expect } from 'vitest'
import { CombatPresentationState } from '../src/foundation/combat/CombatState'
import { parseWeaponDefinitions } from '../src/foundation/combat/WeaponDefinitions'
import { readFile } from 'node:fs/promises'
import { normalizeSettings } from '../src/settings/GameSettings'
import { availableSpawns } from '../src/foundation/conquest/ConquestModule'
import {
    parseMapManifest,
    parseMapGameplay,
} from '../src/foundation/assets/MapManifest'
import { projectRadar } from '../src/foundation/hud/MinimapModel'
import {
    decodeEnvelope,
    encodeMessage,
    MessageType,
    Weapon,
} from '../src/protocol/generated'

describe('Ironworks operational foundation', () => {
    it('keeps ammunition per weapon and cancels a reload on switching', () => {
        const combat = new CombatPresentationState()
        combat.initializeOffline()
        combat.offlineFire(1, 1, Weapon.Rifle, 0)
        expect(combat.beginOfflineReload(2, Weapon.Rifle, 30, 0)).toBe(true)
        combat.selectOfflineWeapon(Weapon.Shotgun)
        expect(combat.localPlayer.magazineAmmo).toBe(6)
        combat.finishOfflineReload(6)
        combat.selectOfflineWeapon(Weapon.Rifle)
        expect(combat.localPlayer.magazineAmmo).toBe(29)
        expect(combat.localPlayer.reloading).toBe(false)
        combat.beginOfflineReload(3, Weapon.Rifle, 30, 0)
        combat.finishOfflineReload(30)
        expect(combat.localPlayer.magazineAmmo).toBe(30)
        expect(combat.localPlayer.reserveAmmo).toBe(119)
    })
    it('validates server weapon definitions and keeps legacy velocity optional', async () => {
        const config = JSON.parse(
            await readFile(
                new URL('../../server/infantry_config.json', import.meta.url),
                'utf8'
            )
        )
        expect(
            parseWeaponDefinitions(JSON.stringify(config))[Weapon.Rifle]
                .muzzleVelocity
        ).toBe(620)
        delete config.weapons.rifle.muzzleVelocity
        expect(
            parseWeaponDefinitions(JSON.stringify(config))[Weapon.Rifle]
                .muzzleVelocity
        ).toBe(0)
        config.weapons.rifle.magazineSize = -1
        expect(() => parseWeaponDefinitions(JSON.stringify(config))).toThrow()
    })

    it('clamps saved settings and rejects corrupt types', () => {
        const value = normalizeSettings({
            fov: 999,
            sensitivity: NaN,
            master: -1,
            invertY: 'yes',
            quality: 'unsafe',
        })
        expect(value.fov).toBe(105)
        expect(value.sensitivity).toBe(1)
        expect(value.master).toBe(0)
        expect(value.invertY).toBe(false)
        expect(value.quality).toBe('auto')
    })
    it('publishes five zones, opposing bases and correctly oriented map coordinates', async () => {
        const root = new URL('../public/maps/ironworks/', import.meta.url),
            manifest = parseMapManifest(
                JSON.parse(
                    await readFile(new URL('manifest.json', root), 'utf8')
                )
            ),
            gameplay = parseMapGameplay(
                JSON.parse(
                    await readFile(new URL('gameplay.json', root), 'utf8')
                ),
                manifest
            )
        expect(
            gameplay.zones.filter((z) => z.type === 'objective')
        ).toHaveLength(5)
        expect(
            gameplay.spawnPoints.filter((s) => s.team === 'west')
        ).toHaveLength(8)
        expect(
            gameplay.spawnPoints.filter((s) => s.team === 'east')
        ).toHaveLength(8)
        expect(
            manifest.worldBounds.max[0] - manifest.worldBounds.min[0]
        ).toBeGreaterThan(400)
        const owned = [
            {
                id: 'a-railhead',
                owner: 1,
                capturing: 0,
                progress: 0,
                contested: false,
            },
        ]
        const allowed = availableSpawns(gameplay.spawnPoints, owned, 1)
        expect(allowed).toHaveLength(11)
        expect(
            allowed.every(
                (s) => s.team === 'west' || s.id.startsWith('a-railhead-spawn-')
            )
        ).toBe(true)
        expect(
            availableSpawns(
                gameplay.spawnPoints,
                [{ ...owned[0], contested: true }],
                1
            )
        ).toHaveLength(8)
        expect(availableSpawns(gameplay.spawnPoints, owned, 0)).toHaveLength(0)
        expect(
            projectRadar(
                { x: -224, z: -168 },
                { minX: -224, maxX: 224, minZ: -168, maxZ: 168, northYaw: 0 }
            )
        ).toEqual({ xPercent: 0, yPercent: 0 })
    })
    it('round trips tactical deployment through generated bounded binary messages', () => {
        const value = {
            type: MessageType.Deploy as const,
            payload: { spawnId: 'west-hq-0', weapon: Weapon.Rifle },
        }
        const decoded = decodeEnvelope(encodeMessage(value))
        expect(decoded.known && decoded.message).toEqual(value)
    })
})
