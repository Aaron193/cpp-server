export type AssetId = string & { readonly __assetId: unique symbol }

export interface AssetDefinition {
    readonly id: AssetId
    /** A catalog implementation detail; gameplay code retains only the id. */
    readonly source: string
}

export interface AssetInstanceOptions {
    readonly namePrefix?: string
    readonly cloneMaterials?: boolean
}

export interface LoadedAsset<TInstance> {
    instantiate(options: Required<AssetInstanceOptions>): TInstance
    dispose(): void
}

export interface AssetSourceLoader<TInstance> {
    load(source: string): Promise<LoadedAsset<TInstance>>
}

const ASSET_ID_PATTERN = /^[a-z][a-z0-9]*(?:[._/-][a-z0-9]+)*$/

export function assetId(value: string): AssetId {
    if (
        !ASSET_ID_PATTERN.test(value) ||
        /\.(?:glb|gltf|babylon)$/i.test(value)
    ) {
        throw new TypeError(
            `Invalid asset id "${value}"; use stable lowercase names, not filenames`
        )
    }
    return value as AssetId
}

/**
 * Maps stable gameplay-facing ids to catalog sources, caches each source load,
 * and creates a fresh scene instance for every request.
 */
export class AssetRegistry<TInstance> {
    private readonly definitions = new Map<AssetId, AssetDefinition>()
    private readonly cache = new Map<AssetId, Promise<LoadedAsset<TInstance>>>()

    constructor(
        definitions: readonly AssetDefinition[],
        private readonly loader: AssetSourceLoader<TInstance>
    ) {
        for (const definition of definitions) {
            if (this.definitions.has(definition.id)) {
                throw new Error(`Duplicate asset id: ${definition.id}`)
            }
            if (definition.source.length === 0) {
                throw new Error(`Asset source is empty: ${definition.id}`)
            }
            this.definitions.set(definition.id, definition)
        }
    }

    has(id: AssetId): boolean {
        return this.definitions.has(id)
    }

    async preload(id: AssetId): Promise<void> {
        await this.load(id)
    }

    async instantiate(
        id: AssetId,
        options: AssetInstanceOptions = {}
    ): Promise<TInstance> {
        const loaded = await this.load(id)
        return loaded.instantiate({
            namePrefix: options.namePrefix ?? id,
            cloneMaterials: options.cloneMaterials ?? false,
        })
    }

    async preloadAll(): Promise<void> {
        await Promise.all([...this.definitions.keys()].map((id) => this.load(id)))
    }

    dispose(): void {
        for (const pending of this.cache.values()) {
            void pending.then((asset) => asset.dispose(), () => undefined)
        }
        this.cache.clear()
    }

    private load(id: AssetId): Promise<LoadedAsset<TInstance>> {
        const cached = this.cache.get(id)
        if (cached) return cached

        const definition = this.definitions.get(id)
        if (!definition) {
            return Promise.reject(new Error(`Unknown asset id: ${id}`))
        }

        const pending = this.loader.load(definition.source)
        this.cache.set(id, pending)
        void pending.catch(() => {
            if (this.cache.get(id) === pending) this.cache.delete(id)
        })
        return pending
    }
}
