#pragma once

#include <cstdint>
#include <map>
#include <random>
#include <unordered_map>
#include <vector>

#include "util/PerlinNoise.hpp"

// Forward declarations
class GameServer;
namespace b2 {
class World;
}
typedef class b2World b2World;

// Constants
constexpr int CHUNK_SIZE = 64;
constexpr uint8_t SEA_LEVEL = 90;
constexpr uint8_t BEACH_LEVEL = 100;
constexpr uint8_t MOUNTAIN_LEVEL = 210;

// Tile flags
namespace TileFlags {
    constexpr uint8_t Water = 1 << 0;
    constexpr uint8_t Solid = 1 << 1;
    constexpr uint8_t Cover = 1 << 2;
}

// Biomes
enum class Biome : uint8_t {
    Ocean = 0,
    TropicalOcean,
    TemperateOcean,
    ArcticOcean,
    Beach,
    Mountain,
    Snow,
    Glacier,
    HotDesert,
    HotSavanna,
    TropicalFrontier,
    TropicalForest,
    TropicalRainforest,
    TemperateDesert,
    TemperateGrassland,
    TemperateFrontier,
    TemperateForest,
    TemperateRainforest,
    ColdDesert,
    Tundra,
    TaigaFrontier,
    Taiga,
    TaigaRainforest,
};

// Tile structure
struct Tile {
    uint8_t height;
    Biome biome;
    uint8_t flags;
};

// Chunk structure
struct Chunk {
    int cx, cy;
    Tile tiles[CHUNK_SIZE * CHUNK_SIZE];
    bool physicsBuilt = false;
};

// Rectangle for physics
struct Rect {
    int x, y, w, h;
};

// River structure
struct River {
    std::vector<std::pair<int, int>> path;
};

// Structure types
enum class StructureType {
    House,
    Tree,
    Rock,
    Bush,
    Crate,
    Wall,
    Fence
};

// Structure
struct Structure {
    StructureType type;
    int x, y;
    int rotation;
    bool destructible;
};

// Spawn point
struct SpawnPoint {
    int x, y;
    float safetyScore;
};

// World generation parameters
struct WorldGenParams {
    uint32_t seed;
    int worldSizeChunks;
    float structureDensity;
    float minCoverDensity;
    int numRivers;  // Added for compatibility
};

// ============================================================================
// SlopeMap - Precomputed gradients for erosion
// ============================================================================
class SlopeMap {
public:
    SlopeMap(int worldSize) : m_worldSize(worldSize) {
        const size_t total = worldSize * worldSize;
        m_slopeX.resize(total);
        m_slopeY.resize(total);
    }

    void Compute(const std::vector<float>& heightMap);

    float GetSlopeX(int x, int y) const {
        return m_slopeX[y * m_worldSize + x];
    }

    float GetSlopeY(int x, int y) const {
        return m_slopeY[y * m_worldSize + x];
    }

private:
    int m_worldSize;
    std::vector<float> m_slopeX;
    std::vector<float> m_slopeY;
};

// ============================================================================
// Erosion droplet
// ============================================================================
struct Droplet {
    float x, y;      // Position
    float dx, dy;    // Direction
    float velocity;  // Speed
    float water;     // Water volume
    float sediment;  // Carried sediment
};

// ============================================================================
// Eroder - Hydraulic erosion simulation
// ============================================================================
class Eroder {
public:
    Eroder(int worldSize, uint32_t seed) 
        : m_worldSize(worldSize), m_rng(seed) {}

    void Erode(std::vector<float>& heightMap, int numDroplets, int maxSteps);

private:
    int m_worldSize;
    std::mt19937 m_rng;
};

// ============================================================================
// WorldGenerator - Main world generation class
// ============================================================================
class WorldGenerator {
public:
    static constexpr uint8_t NO_FLOW = 255;

    WorldGenerator(GameServer& gameServer);
    ~WorldGenerator();

    void GenerateWorld(const WorldGenParams& params);

    // Chunk access
    Chunk* GetChunk(int cx, int cy);
    const Chunk* GetChunk(int cx, int cy) const;

    // Tile access
    Tile* GetTile(int x, int y);
    const Tile* GetTile(int x, int y) const;

    // Physics
    void BuildChunkPhysics(Chunk* chunk, b2World& physicsWorld);

    // Getters
    uint32_t GetSeed() const { return m_seed; }
    const std::vector<River>& GetRivers() const { return m_rivers; }
    const std::vector<Structure>& GetStructures() const { return m_structures; }
    const std::vector<SpawnPoint>& GetSpawnPoints() const { return m_spawnPoints; }
    int GetWorldSize() const { return m_worldSize; }
    
    uint8_t GetFlowDirection(int x, int y) const {
        if (!InBounds(x, y)) return NO_FLOW;
        return m_flowDirection[WorldToTileIndex(x, y)];
    }
    
    const std::vector<uint8_t>& GetFlowDirectionArray() const { return m_flowDirection; }

    int WorldToTileIndex(int x, int y) const;
    bool InBounds(int x, int y) const;

private:
    // Generation pipeline
    void GenerateHeight();
    void GeneratePrecipitation();
    void GenerateTemperature();
    void GenerateBiomes();
    void ApplyErosion();
    void GenerateRivers();
    void GenerateLakes();
    void BuildChunks();
    void GenerateStructures();
    void AnalyzePvPFairness();
    void BalanceMap();
    void GenerateSpawnPoints();

    // Helper functions
    void GenerateRadialGradient(std::vector<float>& output, float centerX, float centerY, 
                                float radius, float centerValue, float edgeValue);
    void GenerateLinearGradient(std::vector<float>& output, float startValue, float endValue);
    void GenerateFractalNoise(std::vector<float>& output, uint32_t seed, int octaves);
    void WeightedMean(std::vector<float>& output, const std::vector<float>& mapA, 
                     const std::vector<float>& mapB, float weight);
    void Subtract(std::vector<float>& output, const std::vector<float>& mapA, 
                 const std::vector<float>& mapB);
    
    void ApplyRiverToMap(const std::vector<std::pair<int, int>>& path);
    
    std::pair<int, int> FindLowestNeighbor(int x, int y) const;
    bool IsFlat(int x, int y, int radius) const;
    bool NearWater(int x, int y, int radius) const;
    uint8_t ComputeTileFlags(int x, int y) const;
    float ComputeSightlineLength(int x, int y, float angle) const;
    float ComputeCoverDensity(int x, int y, int radius) const;
    
    std::vector<Rect> GreedyMerge(const Chunk& chunk) const;
    
    // Chunk key helper
    static uint64_t ChunkKey(int cx, int cy) {
        return (static_cast<uint64_t>(cx) << 32) | static_cast<uint32_t>(cy);
    }

    // Members
    GameServer& m_gameServer;
    WorldGenParams m_params;
    uint32_t m_seed;
    int m_worldSize;

    // Noise generators
    PerlinNoise m_heightNoise;
    PerlinNoise m_moistureNoise;
    PerlinNoise m_temperatureNoise;

    // World data
    std::vector<uint8_t> m_height;
    std::vector<uint8_t> m_biome;
    std::vector<uint8_t> m_flags;
    std::vector<uint8_t> m_flowDirection;

    // Float working buffers
    std::vector<float> m_heightFloat;
    std::vector<float> m_precipitationFloat;
    std::vector<float> m_temperatureFloat;

    // Generated content
    std::unordered_map<uint64_t, Chunk> m_chunks;
    std::vector<River> m_rivers;
    std::vector<Structure> m_structures;
    std::vector<SpawnPoint> m_spawnPoints;
};