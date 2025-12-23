#pragma once

#include <box2d/b2_world.h>

#include <cstdint>
#include <entt/entt.hpp>
#include <memory>
#include <unordered_map>
#include <vector>

#include "util/PerlinNoise.hpp"

class GameServer;

// Biome types for map generation
enum class Biome : uint8_t {
    Ocean = 0,
    Beach,
    Plains,
    Forest,
    Desert,
    Snow,
    Mountain,
    Swamp,
};

// Tile flags for gameplay properties
enum TileFlags : uint8_t {
    None = 0,
    Solid = 1 << 0,           // Blocks movement
    Water = 1 << 1,           // Water tile
    Cover = 1 << 2,           // Provides cover
    DestructibleTile = 1 << 3  // Can be destroyed
};

// Structure types that can be placed on the map
enum class StructureType : uint8_t {
    House = 0,
    Wall,
    Fence,
    Rock,
    Tree,
    Crate,
    Bush,
};

// Single tile in the world
struct Tile {
    uint8_t height = 128;  // 0-255 elevation (128 = sea level)
    Biome biome = Biome::Plains;
    uint8_t flags = TileFlags::None;
};

// Chunk of tiles (64x64)
constexpr int CHUNK_SIZE = 64;

struct Chunk {
    int cx = 0;      // Chunk X coordinate
    int cy = 0;      // Chunk Y coordinate
    Tile tiles[CHUNK_SIZE * CHUNK_SIZE];
    bool physicsBuilt = false;
    entt::entity terrainBody = entt::null;  // Static terrain collision body
};

// River path data
struct River {
    std::vector<std::pair<int, int>> path;  // World tile coordinates
};

// Structure instance
struct Structure {
    StructureType type;
    int x, y;  // World tile coordinates
    uint8_t rotation = 0;
    bool destructible = false;
    entt::entity entity = entt::null;  // ECS entity if spawned
};

// Rectangle for greedy merging
struct Rect {
    int x, y, w, h;
};

// Spawn point with safety score
struct SpawnPoint {
    float x, y;         // World coordinates
    float safetyScore;  // Higher = safer
};

// World generation parameters
struct WorldGenParams {
    uint32_t seed = 12345;
    int worldSizeChunks = 32;  // 32x32 chunks = 2048x2048 tiles
    int numRivers = 8;
    float structureDensity = 0.002f;  // Chance per tile
    int maxSightlineLength = 20;      // Tiles
    float minCoverDensity = 0.15f;    // 15% of region should have cover
};

class WorldGenerator {
   public:
    WorldGenerator(GameServer& gameServer);
    ~WorldGenerator();

    // Generate the entire world
    void GenerateWorld(const WorldGenParams& params);

    // Get chunk (creates if not exists)
    Chunk* GetChunk(int cx, int cy);
    const Chunk* GetChunk(int cx, int cy) const;

    // Get tile at world coordinates
    Tile* GetTile(int x, int y);
    const Tile* GetTile(int x, int y) const;

    // World info
    uint32_t GetSeed() const { return m_seed; }
    int GetWorldSize() const { return m_worldSize; }
    const std::vector<River>& GetRivers() const { return m_rivers; }
    const std::vector<Structure>& GetStructures() const {
        return m_structures;
    }
    const std::vector<SpawnPoint>& GetSpawnPoints() const {
        return m_spawnPoints;
    }
    uint8_t GetFlowDirection(int x, int y) const {
        if (!InBounds(x, y)) return NO_FLOW;
        return m_flowDirection[WorldToTileIndex(x, y)];
    }

    // Build physics for a chunk
    void BuildChunkPhysics(Chunk* chunk, b2World& physicsWorld);

    // Constants
    static constexpr uint8_t NO_FLOW = 255;

   private:
    // Generation phases
    void GenerateHeight();
    void GenerateBiomes();
    void GenerateRivers();
    void ApplyRiverToMap(const std::vector<std::pair<int, int>>& path);
    void GenerateLakes();
    void GenerateStructures();
    void AnalyzePvPFairness();
    void BalanceMap();
    void GenerateSpawnPoints();

    // Helper functions
    void BuildChunks();
    int WorldToTileIndex(int x, int y) const;
    bool InBounds(int x, int y) const;
    std::pair<int, int> FindLowestNeighbor(int x, int y) const;
    bool IsFlat(int x, int y, int radius = 2) const;
    bool NearWater(int x, int y, int radius = 5) const;
    uint8_t ComputeTileFlags(int x, int y) const;

    // Greedy collider merging
    std::vector<Rect> GreedyMerge(const Chunk& chunk) const;

    // LOS/Sightline analysis
    float ComputeSightlineLength(int x, int y, float angle) const;
    float ComputeCoverDensity(int x, int y, int radius) const;

   private:
    GameServer& m_gameServer;

    uint32_t m_seed;
    WorldGenParams m_params;
    int m_worldSize;  // Width and height in tiles

    // Noise generators
    PerlinNoise m_heightNoise;
    PerlinNoise m_moistureNoise;
    PerlinNoise m_temperatureNoise;

    // Full world data (for generation only)
    std::vector<uint8_t> m_height;
    std::vector<uint8_t> m_biome;
    std::vector<uint8_t> m_flags;
    std::vector<uint8_t> m_flowDirection;  // Flow angle in 0-255 (0-360 degrees)

    // Final chunked data
    std::unordered_map<int64_t, Chunk> m_chunks;

    // World features
    std::vector<River> m_rivers;
    std::vector<Structure> m_structures;
    std::vector<SpawnPoint> m_spawnPoints;

    // Constants
    static constexpr uint8_t SEA_LEVEL = 90;
    static constexpr uint8_t BEACH_LEVEL = 100;
    static constexpr uint8_t MOUNTAIN_LEVEL = 210;
};

// Helper to convert chunk coords to hash key
inline int64_t ChunkKey(int cx, int cy) {
    return (static_cast<int64_t>(cx) << 32) | static_cast<uint32_t>(cy);
}
