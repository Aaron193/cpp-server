import * as PIXI from 'pixi.js'
import { EntityTypes } from '../../enums/EntityTypes'

export class AssetLoader {
    private static assets: Record<string, string> = {
        bush_1: 'assets/img/bush_1.png',
        bush_2: 'assets/img/bush_2.png',
        rock_1: 'assets/img/rock_1.png',
        rock_2: 'assets/img/rock_2.png',
        wall_1: 'assets/img/wall_1.png',
        fence_1: 'assets/img/fence_1.png',
        tree_1: 'assets/img/tree_1.png',
        tree_2: 'assets/img/tree_2.png',
    }

    private static loaded: boolean = false
    private static loadedAssets: Set<string> = new Set()
    private static fallbackTexture: string = 'rock_1' // Use rock_1 as fallback

    static async loadAll(): Promise<void> {
        if (this.loaded) return

        const loader = PIXI.Assets
        const assetPromises = Object.entries(this.assets).map(async ([key, url]) => {
            try {
                await loader.load({ alias: key, src: url })
                this.loadedAssets.add(key)
            } catch (error) {
                console.warn(`[AssetLoader] Failed to load ${key} from ${url}, will use fallback`)
            }
        })
        await Promise.all(assetPromises)
        this.loaded = true
    }

    static getTexture(key: string): PIXI.Texture {
        // If the texture wasn't loaded, use fallback
        if (!this.loadedAssets.has(key)) {
            console.warn(`[AssetLoader] Texture "${key}" not loaded, using fallback: ${this.fallbackTexture}`)
            return PIXI.Texture.from(this.fallbackTexture)
        }
        return PIXI.Texture.from(key)
    }

    static getTextureFromType(type: number, variant: number): PIXI.Texture {
        let key: string
        
        switch (type) {
            case EntityTypes.BUSH:
                key = `bush_${variant}`
                break
            case EntityTypes.ROCK:
                key = `rock_${variant}`
                break
            case EntityTypes.WALL:
                key = `wall_${variant}`
                break
            case EntityTypes.FENCE:
                key = `fence_${variant}`
                break
            case EntityTypes.TREE:
                key = `tree_${variant}`
                break
            default:
                console.warn(`Unknown entity type: ${type}, using fallback`)
                return this.getTexture(this.fallbackTexture)
        }

        return this.getTexture(key)
    }
}
