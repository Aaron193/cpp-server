import * as PIXI from 'pixi.js'

export class AssetLoader {
    private static assets: Record<string, string> = {
        bush_1: 'assets/img/bush_1.png',
        bush_2: 'assets/img/bush_2.png',
        rock_1: 'assets/img/rock_1.png',
        rock_2: 'assets/img/rock_2.png',
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
