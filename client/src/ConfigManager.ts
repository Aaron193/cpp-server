import type { ValidatedGameConfiguration } from './foundation/networking/Handshake'

export class ConfigManager {
    private static config: ValidatedGameConfiguration | null = null

    static setConfig(config: ValidatedGameConfiguration): void {
        if (ConfigManager.config) {
            throw new Error('GameConfig already set')
        }
        ConfigManager.config = config
    }

    static resetConfig(): void {
        ConfigManager.config = null
    }
    static getConfig(): ValidatedGameConfiguration {
        if (!ConfigManager.config) {
            throw new Error('GameConfig not initialized')
        }
        return ConfigManager.config
    }
}
