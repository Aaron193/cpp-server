import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
await mkdir('artifacts', { recursive: true })
const browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--no-sandbox'],
})
try {
    const page = await browser.newPage({
            viewport: { width: 1440, height: 900 },
        }),
        errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.route('http://localhost:3000/servers', (route) =>
        route.fulfill({ json: { servers: [] } })
    )
    await page.route('http://localhost:3000/auth/me', (route) =>
        route.fulfill({ status: 401, json: {} })
    )
    await page.goto(
        'http://127.0.0.1:5173/?renderBackend=webgl2&renderTier=low'
    )
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({
        path: 'artifacts/iron-front-menu.jpg',
        fullPage: true,
    })
    await page.click('#offline-play-btn')
    await page.waitForFunction(() => window.__gameDebug, undefined, {
        timeout: 60000,
    })
    await page.waitForTimeout(3000)
    await page.screenshot({ path: 'artifacts/deployment.jpg' })
    await page.click('.deploy-button')
    await page.waitForTimeout(3000)
    await page.screenshot({ path: 'artifacts/ironworks-low.jpg' })
    console.log(
        JSON.stringify(
            {
                fixture: 'empty discovery; offline exploration',
                errors,
                debug: await page.evaluate(() => window.__gameDebug()),
            },
            null,
            2
        )
    )
    if (errors.length) throw new Error(errors.join('\n'))
} finally {
    await browser.close()
}
