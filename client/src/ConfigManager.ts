export interface GameConfig {
    weapons: {
        pistol: WeaponConfig
        rifle: WeaponConfig
        shotgun: WeaponConfig
    }
}

export interface WeaponConfig {
    fireMode: 'hitscan' | 'projectile'
    ammoType: 'light' | 'heavy' | 'shell' | 'rocket'
    magazineSize: number
    ammoPerShot: number
    fireRate: number
    reloadTime: number
    damage: number
    range: number
    spread: number
    pellets: number
    barrelLength: number
    projectileSpeed: number
    projectileLifetime: number
    automatic: boolean
}

export class ConfigManager {
    private static config: GameConfig | null = null

    static setConfig(config: GameConfig): void {
        if (ConfigManager.config) {
            throw new Error('GameConfig already set')
        }
        ConfigManager.config = config
    }

    static resetConfig(): void {
        ConfigManager.config = null
    }
    static getConfig(): GameConfig {
        if (!ConfigManager.config) {
            throw new Error('GameConfig not initialized')
        }
        return ConfigManager.config
    }
}
