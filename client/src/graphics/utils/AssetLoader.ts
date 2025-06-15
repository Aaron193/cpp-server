import * as PIXI from 'pixi.js'

export class AssetLoader {
    private static assets: Record<string, string> = {
        bush: 'assets/img/bush.png',
        rock: 'assets/img/rock.png',
    }

    private static loaded: boolean = false

    static async loadAll(): Promise<void> {
        if (this.loaded) return

        const loader = PIXI.Assets
        const assetPromises = Object.entries(this.assets).map(([key, url]) =>
            loader.load({ alias: key, src: url })
        )
        await Promise.all(assetPromises)
        this.loaded = true
    }

    static getTexture(key: string): PIXI.Texture {
        return PIXI.Texture.from(key)
    }
}
