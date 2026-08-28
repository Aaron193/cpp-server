import { expect, test } from '@playwright/test'
import { deriveHudStates } from '../src/foundation/hud/HudState'
import { MatchFeelClock } from '../src/foundation/hud/MatchFeel'
import { MatchPhase } from '../src/protocol/generated'

const viewports = [
    { name: '4x3', width: 1024, height: 768, dpr: 1 },
    { name: '16x9-retina', width: 1280, height: 720, dpr: 2 },
    { name: 'ultrawide', width: 1728, height: 720, dpr: 1 },
] as const

test('captures software WebGL2 budgets across DPR and aspect states', async ({ browser }, testInfo) => {
    for (const state of viewports) {
        const context = await browser.newContext({ viewport: state, deviceScaleFactor: state.dpr })
        const page = await context.newPage()
        await page.goto('/?renderBackend=webgl2&renderTier=software')
        await page.getByRole('button', { name: /Practice Offline/ }).click()
        await expect(page.locator('#game_canvas')).toBeVisible({ timeout: 15_000 })
        await expect.poll(async () => (await page.evaluate(() => window.__arenaProfile?.()))?.fps ?? 0, { timeout: 15_000 }).toBeGreaterThan(0)
        // ProfileStats holds 240 frames. Five seconds replaces startup/Jolt
        // compilation frames before applying the steady software-tier gate.
        await page.waitForTimeout(5_000)
        const profile = await page.evaluate(() => window.__arenaProfile?.())
        expect(profile).toMatchObject({ backend: 'webgl2', renderTier: 'software', shadersReady: true, finalGradePasses: 0, shadowsEnabled: false })
        expect(profile!.aspect).toBeCloseTo(state.width / state.height, 2)
        expect(profile!.effectiveDpr).toBeLessThanOrEqual(.75)
        expect(profile!.frameP95Ms).toBeLessThanOrEqual(50)
        expect(profile!.effectActive).toBeLessThanOrEqual(profile!.effectCapacity)
        await page.screenshot({ path: testInfo.outputPath(`${state.name}-dpr${state.dpr}.png`) })
        await testInfo.attach(`${state.name}-profile.json`, { body: JSON.stringify(profile, null, 2), contentType: 'application/json' })
        await context.close()
    }
})

test('an explicit unavailable WebGPU request fails visibly', async ({ browser }) => {
    const context = await browser.newContext()
    await context.addInitScript(() => Object.defineProperty(navigator, 'gpu', { configurable: true, value: undefined }))
    const page = await context.newPage()
    await page.goto('/?renderBackend=webgpu&renderTier=software')
    await page.getByRole('button', { name: /Practice Offline/ }).click()
    await expect(page.locator('.fps-load-error')).toContainText(/WebGPU was explicitly requested but is unavailable/, { timeout: 15_000 })
    await context.close()
})

test('captures stepped HUD, action, minimap-policy and killcam state facts', async ({}, testInfo) => {
    const feel = new MatchFeelClock(); feel.hit(1000); feel.resource(1000); feel.kill(1000)
    const common = { phase: MatchPhase.Active, dead: false, reloading: false, damaged: false, replay: 'live' as const }
    const captures = {
        steppedClock: [1000, 1075, 1150, 1380, 1700].map((nowMs) => ({ nowMs, state: feel.sample(nowMs, Math.max(0, 5 - (nowMs - 1000) / 1000)) })),
        hud: {
            connecting: deriveHudStates({ ...common, connection: 'connecting' }),
            activeDamageReload: deriveHudStates({ ...common, connection: 'connected', damaged: true, reloading: true }),
            deathKillcam: deriveHudStates({ ...common, connection: 'connected', dead: true, replay: 'killcam' }),
            respawnSpectate: deriveHudStates({ ...common, connection: 'connected', dead: true, replay: 'spectator' }),
            mapMismatch: deriveHudStates({ ...common, connection: 'rejected', detail: 'map mismatch' }),
        },
        minimapPolicy: 'north-up; local pose plus bounded fading gunfire rumors; no live FFA enemy poses',
    }
    expect(captures.hud.deathKillcam).toEqual(expect.arrayContaining(['death', 'killcam']))
    expect(captures.hud.mapMismatch).toContain('mismatch')
    await testInfo.attach('stepped-ux-state-captures.json', { body: JSON.stringify(captures, null, 2), contentType: 'application/json' })
})
