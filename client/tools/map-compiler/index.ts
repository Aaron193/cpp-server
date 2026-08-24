import { parseMapGltf } from './gltf'
import { compileParsedMap } from './output'
import type { CompiledMap } from './types'

export { MapCompileError } from './types'
export type { CompiledMap, MapManifest } from './types'

export function compileMapGltf(input: unknown): CompiledMap {
    return compileParsedMap(parseMapGltf(input))
}
