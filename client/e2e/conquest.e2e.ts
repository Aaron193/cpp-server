import { expect, test, type BrowserContext } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { issueJoinTicket } from '../../web/src/servers/join-ticket'
import { PROTOCOL_VERSION } from '../src/protocol/generated'

const manifest = JSON.parse(
    readFileSync(
        new URL('../public/maps/ironworks/manifest.json', import.meta.url),
        'utf8'
    )
)
const server = {
    id: 'ironworks-e2e',
    host: '127.0.0.1',
    port: 9003,
    region: 'Local test',
    maxPlayers: 12,
    currentPlayers: 0,
    lastHeartbeat: new Date().toISOString(),
    isOnline: true,
    buildId: 'dev',
    protocolVersion: PROTOCOL_VERSION,
    mapId: 'ironworks',
    mapFormatVersion: 2,
    mapContentHash: manifest.contentHash,
    mode: 'conquest',
    websocketUrl: 'ws://127.0.0.1:9003',
}

async function join(context: BrowserContext, user: string) {
    const page = await context.newPage()
    await page.route('http://localhost:3000/servers', (route) =>
        route.fulfill({ json: { servers: [server] } })
    )
    await page.route('http://localhost:3000/auth/me', (route) =>
        route.fulfill({ status: 401, json: {} })
    )
    await page.route(
        'http://localhost:3000/servers/ironworks-e2e/join',
        (route) => {
            const { ticket } = issueJoinTicket(
                user,
                server.id,
                'playwright-join-ticket-secret-32-bytes-minimum',
                'arena-game-server',
                30
            )
            return route.fulfill({
                json: { websocketUrl: server.websocketUrl, ticket },
            })
        }
    )
    await page.goto('/?renderBackend=webgl2&renderTier=software')
    await page.locator('#quick-play-btn').click()
    await expect(page.locator('.deployment')).toBeVisible({ timeout: 60_000 })
    await expect(page.locator('.deploy-button')).toBeEnabled({
        timeout: 15_000,
    })
    return page
}

test('two clients deploy into opposing teams and replicate infantry movement and combat', async ({
    browser,
}, info) => {
    test.setTimeout(180_000)
    const westContext = await browser.newContext(),
        eastContext = await browser.newContext()
    const errors: string[] = []
    try {
        const west = await join(westContext, 'west-test'),
            east = await join(eastContext, 'east-test')
        for (const page of [west, east])
            page.on('pageerror', (error) => errors.push(error.message))
        const w = await west.evaluate(() => window.__gameDebug!()!),
            e = await east.evaluate(() => window.__gameDebug!()!)
        expect(w.conquest?.localTeam).toBe(1)
        expect(e.conquest?.localTeam).toBe(2)
        expect(w.conquest?.objectives).toHaveLength(5)
        expect(w.conquest?.westTickets).toBe(500)
        expect(await west.locator('.deploy-spawn').count()).toBe(1)
        expect(await east.locator('.deploy-spawn').count()).toBe(1)
        await west.screenshot({
            path: info.outputPath('ironworks-deployment.png'),
        })
        for (const page of [west, east]) {
            await page.bringToFront()
            await page.locator('.deploy-button').click()
            await expect(page.locator('.deployment')).toBeHidden({
                timeout: 15_000,
            })
            await expect(page.locator('#fps-health')).toHaveText('100')
        }
        await expect
            .poll(
                async () =>
                    (await west.evaluate(() => window.__gameDebug!()!))
                        .remotePlayers
            )
            .toBe(1)
        await west.bringToFront()
        await west.locator('#game_canvas').click()
        const before = await west.evaluate(
            () => window.__gameDebug!()!.localPosition
        )
        await west.keyboard.down('w')
        await west.keyboard.down('Shift')
        await expect
            .poll(
                async () =>
                    (await west.evaluate(() => window.__gameDebug!()!))
                        .localMovement.mode
            )
            .toBe(1)
        await expect
            .poll(async () => {
                const pos = await west.evaluate(
                    () => window.__gameDebug!()!.localPosition
                )
                return Math.hypot(pos.x - before.x, pos.z - before.z)
            })
            .toBeGreaterThan(2)
        await west.keyboard.up('Shift')
        await west.keyboard.up('w')
        await west.keyboard.down('c')
        await expect
            .poll(
                async () =>
                    (await east.evaluate(() => window.__gameDebug!()!))
                        .remoteActors[0]?.stance
            )
            .toBe(1)
        await west.keyboard.up('c')
        await west.mouse.down({ button: 'right' })
        await expect
            .poll(
                async () =>
                    (await west.evaluate(() => window.__gameDebug!()!)).input
                        .aimProgress
            )
            .toBeGreaterThan(0.9)
        await west.mouse.down({ button: 'left' })
        await expect
            .poll(async () =>
                Number(
                    (await west.locator('#fps-ammo').innerText()).split('/')[0]
                )
            )
            .toBeLessThan(30)
        await west.mouse.up({ button: 'left' })
        await west.mouse.up({ button: 'right' })
        await west.keyboard.press('r')
        await expect(west.locator('#fps-ammo')).toContainText('30 /', {
            timeout: 10_000,
        })
        expect(errors).toEqual([])
        await info.attach('conquest-runtime.json', {
            body: JSON.stringify(
                {
                    west: await west.evaluate(() => window.__gameDebug!()!),
                    east: await east.evaluate(() => window.__gameDebug!()!),
                },
                null,
                2
            ),
            contentType: 'application/json',
        })
    } finally {
        await westContext.close()
        await eastContext.close()
    }
})
