import { expect, test } from '@playwright/test'
import type { mountCombatScene } from './fixtures/combat-scene'

declare global {
    interface Window {
        combatFixture: Awaited<ReturnType<typeof mountCombatScene>>
    }
}

test('renders muzzle, travelling tracers, clipped bullet holes and confirmed damage feedback', async ({
    page,
}, testInfo) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('http://localhost:3000/servers', (route) =>
        route.fulfill({ json: { servers: [] } })
    )
    await page.route('http://localhost:3000/auth/me', (route) =>
        route.fulfill({ status: 401, json: {} })
    )
    await page.goto('/')
    await page.evaluate(async () => {
        const path = '/e2e/fixtures/combat-scene.ts'
        const { mountCombatScene } = await import(/* @vite-ignore */ path)
        window.combatFixture = await mountCombatScene()
    })
    await page.evaluate(async () => {
        const f = window.combatFixture
        f.shoot()
        f.incoming()
        f.impact()
        f.hit()
        f.health(18)
        f.hurt()
        await f.step(1000)
        await f.step(1018)
    })
    await expect(page.locator('#fps-hit-damage')).toHaveText('28')
    await expect(page.locator('#fps-hitmarker')).toHaveClass('active')
    const initial = await page.evaluate(() => window.combatFixture.facts())
    expect(initial.decals).toEqual([
        { vertices: expect.any(Number), material: 'effects/hole' },
    ])
    expect(initial.decals[0]!.vertices).toBeGreaterThan(0)
    expect(initial.tracers.every((t) => t.group === 0)).toBe(true)
    await page.screenshot({
        path: testInfo.outputPath('combat-flash-and-feedback.png'),
    })
    await page.evaluate(async () => {
        await window.combatFixture.step(1030)
    })
    await page.screenshot({
        path: testInfo.outputPath('combat-incoming-tracer.png'),
    })
    await page.evaluate(async () => {
        const f = window.combatFixture
        f.turn(Math.PI / 2)
        await f.step(1120)
    })
    const angle = await page
        .locator('#fps-damage > i')
        .first()
        .evaluate((el) => el.style.getPropertyValue('--damage-angle'))
    expect(parseFloat(angle)).toBeCloseTo(-Math.PI / 6)
    await page.evaluate(async () => {
        const f = window.combatFixture
        f.hit(2, 28)
        await f.step(1130)
    })
    await expect(page.locator('#fps-hit-damage')).toHaveText('56')
    await page.evaluate(async () => {
        const f = window.combatFixture
        f.hit(3, 17)
        await f.step(1200)
    })
    await expect(page.locator('#fps-hit-damage')).toHaveText('17')
    await page.evaluate(async () => {
        const f = window.combatFixture
        f.kill()
        await f.step(1230)
        await f.step(1280)
    })
    await expect(page.locator('#fps-hitmarker')).toHaveClass('active kill')
    await page.screenshot({
        path: testInfo.outputPath('combat-trauma-and-kill.png'),
    })
    await page.evaluate(async () => {
        await window.combatFixture.step(1800)
    })
    await expect(page.locator('#fps-hitmarker')).not.toHaveClass(/active/)
    await expect(page.locator('#fps-hit-damage')).toHaveClass(/active/)
    expect(
        (await page.evaluate(() => window.combatFixture.facts())).tracers
    ).toHaveLength(0)
    await page.evaluate(async () => {
        await window.combatFixture.step(3000)
    })
    await expect(page.locator('#fps-hit-damage')).not.toHaveClass(/active/)
    const depth = await page.evaluate(() => window.combatFixture.depthProof())
    expect(depth.hiddenDelta).toBeLessThanOrEqual(1)
    expect(depth.visibleDelta).toBeGreaterThan(10)
    const skyPixels = await page.evaluate(() => window.combatFixture.skyProof())
    expect(skyPixels).toBeGreaterThan(15)
    await page.screenshot({
        path: testInfo.outputPath('remote-sky-tracer.png'),
    })
    expect(errors).toEqual([])
})
