import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
    const environment = loadEnv(mode, '.', '')
    const configuredPort = Number(environment.CLIENT_PORT ?? 3001)

    return {
        base: './',
        server: {
            port: Number.isInteger(configuredPort) ? configuredPort : 3001,
        },
        build: {
            sourcemap: true,
        },
    }
})
