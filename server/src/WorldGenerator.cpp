#include "WorldGenerator.hpp"

#include <box2d/b2_body.h>
#include <box2d/b2_fixture.h>
#include <box2d/b2_polygon_shape.h>

#include <algorithm>
#include <cmath>
#include <iostream>
#include <random>

#include "GameServer.hpp"
#include "ecs/EntityManager.hpp"

WorldGenerator::WorldGenerator(GameServer& gameServer)
    : m_gameServer(gameServer),
      m_seed(0),
      m_worldSize(0),
      m_heightNoise(0),
      m_moistureNoise(0),
      m_temperatureNoise(0) {}

WorldGenerator::~WorldGenerator() {}

void WorldGenerator::GenerateWorld(const WorldGenParams& params) {
    m_params = params;
    m_seed = params.seed;
    m_worldSize = params.worldSizeChunks * CHUNK_SIZE;

    std::cout << "Generating world with seed " << m_seed << std::endl;
    std::cout << "World size: " << m_worldSize << "x" << m_worldSize << " tiles"
              << std::endl;

    // Allocate world arrays
    size_t totalTiles = m_worldSize * m_worldSize;
    m_height.resize(totalTiles);
    m_biome.resize(totalTiles);
    m_flags.resize(totalTiles);
    m_flowDirection.resize(totalTiles, WorldGenerator::NO_FLOW);

    // Initialize noise generators with deterministic seeds
    m_heightNoise = PerlinNoise(m_seed);
    m_moistureNoise = PerlinNoise(m_seed + 1);
    m_temperatureNoise = PerlinNoise(m_seed + 2);

    // Generation pipeline
    std::cout << "Generating heightmap..." << std::endl;
    GenerateHeight();

    std::cout << "Generating biomes..." << std::endl;
    GenerateBiomes();

    std::cout << "Generating rivers..." << std::endl;
    GenerateRivers();

    std::cout << "Generating lakes..." << std::endl;
    GenerateLakes();

    std::cout << "Building chunks..." << std::endl;
    BuildChunks();

    std::cout << "Generating structures..." << std::endl;
    GenerateStructures();

    std::cout << "Analyzing PvP fairness..." << std::endl;
    AnalyzePvPFairness();

    std::cout << "Balancing map..." << std::endl;
    BalanceMap();

    std::cout << "Generating spawn points..." << std::endl;
    GenerateSpawnPoints();

    std::cout << "World generation complete!" << std::endl;
    std::cout << "Chunks: " << m_chunks.size() << std::endl;
    std::cout << "Rivers: " << m_rivers.size() << std::endl;
    std::cout << "Structures: " << m_structures.size() << std::endl;
    std::cout << "Spawn points: " << m_spawnPoints.size() << std::endl;
}

void WorldGenerator::GenerateHeight() {
    // Use fractal noise with 3 octaves at 0.002 frequency to match client
    const float frequency = 0.002f;
    const int octaves = 3;
    const float persistence = 0.5f;

    for (int y = 0; y < m_worldSize; y++) {
        for (int x = 0; x < m_worldSize; x++) {
            int idx = WorldToTileIndex(x, y);
            
            // Get fractal noise value in range [-1, 1]
            float h = m_heightNoise.fractal(
                static_cast<float>(x) * frequency,
                static_cast<float>(y) * frequency,
                octaves,
                persistence
            );
            
            // Normalize from [-1, 1] to [0, 1]
            h = h * 0.5f + 0.5f;
            h = std::clamp(h, 0.0f, 1.0f);

            m_height[idx] = static_cast<uint8_t>(h * 255.0f);
        }
    }
}

void WorldGenerator::GenerateBiomes() {
    const float moistureFreq = 0.005f;
    const float temperatureFreq = 0.003f;

    for (int y = 0; y < m_worldSize; y++) {
        for (int x = 0; x < m_worldSize; x++) {
            int idx = WorldToTileIndex(x, y);
            uint8_t h = m_height[idx];
            
            // Get moisture and temperature noise, normalized to [0, 1]
            float m = m_moistureNoise.noise(
                static_cast<float>(x) * moistureFreq,
                static_cast<float>(y) * moistureFreq
            ) * 0.5f + 0.5f;
            
            float t = m_temperatureNoise.noise(
                static_cast<float>(x) * temperatureFreq,
                static_cast<float>(y) * temperatureFreq
            ) * 0.5f + 0.5f;

            Biome biome;

            if (h < SEA_LEVEL) {
                biome = Biome::Ocean;
                m_flags[idx] |= TileFlags::Water;  // Mark ocean tiles as water
            } else if (h < BEACH_LEVEL) {
                biome = Biome::Beach;
            } else if (h > MOUNTAIN_LEVEL) {
                biome = Biome::Mountain;
            } else if (t < 0.3f) {
                biome = Biome::Snow;
            } else if (m > 0.7f) {
                biome = Biome::Forest;
            } else if (t > 0.7f && m < 0.3f) {
                biome = Biome::Desert;
            } else if (m > 0.5f && h < 120) {
                biome = Biome::Swamp;
            } else {
                biome = Biome::Plains;
            }

            m_biome[idx] = static_cast<uint8_t>(biome);
        }
    }
}

void WorldGenerator::GenerateRivers() {
    std::mt19937 rng(m_seed);
    std::uniform_int_distribution<int> dist(0, m_worldSize - 1);

    for (int i = 0; i < m_params.numRivers; i++) {
        River river;

        // Find a high elevation starting point (mountains or hills)
        int startX, startY;
        int attempts = 0;
        do {
            startX = dist(rng);
            startY = dist(rng);
            attempts++;
        } while (m_height[WorldToTileIndex(startX, startY)] < 130 &&  // Lower threshold
                 attempts < 2000);  // More attempts

        if (attempts >= 2000) {
            std::cout << "River " << i << " failed to find start point after " << attempts << " attempts" << std::endl;
            continue;
        }

        int x = startX, y = startY;
        std::unordered_set<int64_t> visited;
        std::vector<std::pair<int, int>> pathWithFlow;

        // Flow downhill with channel digging
        while (InBounds(x, y) && m_height[WorldToTileIndex(x, y)] >= SEA_LEVEL) {
            int64_t key = (static_cast<int64_t>(x) << 32) | static_cast<uint32_t>(y);
            if (visited.count(key)) break;
            visited.insert(key);

            river.path.push_back({x, y});
            pathWithFlow.push_back({x, y});

            auto [nextX, nextY] = FindLowestNeighbor(x, y);
            
            // If stuck, allow river to dig through slightly
            if (nextX == x && nextY == y) {
                // Find any neighbor lower than current + threshold
                uint8_t currentHeight = m_height[WorldToTileIndex(x, y)];
                for (int i = 0; i < 8; i++) {
                    static const int dx[] = {-1, 0, 1, -1, 1, -1, 0, 1};
                    static const int dy[] = {-1, -1, -1, 0, 0, 1, 1, 1};
                    int nx = x + dx[i];
                    int ny = y + dy[i];
                    if (InBounds(nx, ny)) {
                        uint8_t neighborHeight = m_height[WorldToTileIndex(nx, ny)];
                        if (neighborHeight < currentHeight + 5) {  // Allow small uphill
                            nextX = nx;
                            nextY = ny;
                            break;
                        }
                    }
                }
                if (nextX == x && nextY == y) break;  // Really stuck
            }

            x = nextX;
            y = nextY;

            if (river.path.size() > 2000) break;  // Safety limit
        }

        if (river.path.size() > 10) {
            m_rivers.push_back(river);
            std::cout << "River " << m_rivers.size() << " created with " << river.path.size() << " points" << std::endl;

            // Now populate flow direction and create thick river with edges
            ApplyRiverToMap(pathWithFlow);
        } else {
            std::cout << "River rejected - only " << river.path.size() << " points" << std::endl;
        }
    }
}

void WorldGenerator::ApplyRiverToMap(const std::vector<std::pair<int, int>>& path) {
    if (path.empty()) return;

    constexpr int RIVER_WIDTH = 3;  // 3 tiles wide (center + 1 on each side)
    
    // Mark river tiles and calculate flow direction
    for (size_t i = 0; i < path.size(); i++) {
        int x = path[i].first;
        int y = path[i].second;

        // Calculate flow direction from this tile to next
        int nextX = x;
        int nextY = y;
        if (i + 1 < path.size()) {
            nextX = path[i + 1].first;
            nextY = path[i + 1].second;
        }

        // Calculate angle in radians
        float dx = static_cast<float>(nextX - x);
        float dy = static_cast<float>(nextY - y);
        float angle = std::atan2(dy, dx);

        // Convert angle [-π, π] to 0-255 range (0 = -π, 128 = 0, 255 = π)
        uint8_t flowDir = static_cast<uint8_t>(((angle + M_PI) / (2.0f * M_PI)) * 255.0f);

        // Mark the center tile as water and set flow direction
        if (InBounds(x, y)) {
            int idx = WorldToTileIndex(x, y);
            m_flags[idx] |= TileFlags::Water;
            m_flowDirection[idx] = flowDir;
        }

        // Expand river width - create thick river
        for (int dy = -RIVER_WIDTH; dy <= RIVER_WIDTH; dy++) {
            for (int dx = -RIVER_WIDTH; dx <= RIVER_WIDTH; dx++) {
                int nx = x + dx;
                int ny = y + dy;

                if (!InBounds(nx, ny)) continue;

                int nIdx = WorldToTileIndex(nx, ny);
                
                // Distance from center
                float dist = std::sqrt(static_cast<float>(dx * dx + dy * dy));

                // Mark water within radius
                if (dist <= RIVER_WIDTH) {
                    m_flags[nIdx] |= TileFlags::Water;
                    if (m_flowDirection[nIdx] == NO_FLOW) {  // Don't overwrite existing flow
                        m_flowDirection[nIdx] = flowDir;
                    }
                    
                    // Mark edge tiles (distance > RIVER_WIDTH - 1) for biome transition
                    if (dist > RIVER_WIDTH - 0.5f) {
                        m_flags[nIdx] |= TileFlags::Cover;  // Mark as edge
                    }
                }
            }
        }
    }

    // Post-process to add edge biomes (Beach/Swamp transitions)
    for (int y = 0; y < m_worldSize; y++) {
        for (int x = 0; x < m_worldSize; x++) {
            int idx = WorldToTileIndex(x, y);

            // If this is water, check neighbors for edge marking
            if (m_flags[idx] & TileFlags::Water) {
                // Check if this is an edge by looking for non-water neighbors
                bool isEdge = false;
                for (int dy = -1; dy <= 1; dy++) {
                    for (int dx = -1; dx <= 1; dx++) {
                        if (dx == 0 && dy == 0) continue;
                        int nIdx = WorldToTileIndex(x + dx, y + dy);
                        if (InBounds(x + dx, y + dy)) {
                            if (!(m_flags[nIdx] & TileFlags::Water)) {
                                isEdge = true;
                                break;
                            }
                        }
                    }
                    if (isEdge) break;
                }

                // Edge tiles get special biome treatment
                if (isEdge && !(m_flags[idx] & TileFlags::Cover)) {
                    uint8_t height = m_height[idx];
                    // Water edges become beach/swamp depending on height
                    if (height < SEA_LEVEL + 15) {
                        m_biome[idx] = static_cast<uint8_t>(Biome::Beach);
                    } else {
                        m_biome[idx] = static_cast<uint8_t>(Biome::Swamp);
                    }
                }
            }
        }
    }
}

void WorldGenerator::GenerateLakes() {
    // Simple lake generation: find low points and mark as water
    for (int y = 1; y < m_worldSize - 1; y++) {
        for (int x = 1; x < m_worldSize - 1; x++) {
            int idx = WorldToTileIndex(x, y);
            uint8_t h = m_height[idx];

            if (h >= SEA_LEVEL + 5 && h < SEA_LEVEL + 20) {
                // Check if this is a local minimum
                bool isMinimum = true;
                for (int dy = -1; dy <= 1; dy++) {
                    for (int dx = -1; dx <= 1; dx++) {
                        if (dx == 0 && dy == 0) continue;
                        int nIdx = WorldToTileIndex(x + dx, y + dy);
                        if (m_height[nIdx] < h) {
                            isMinimum = false;
                            break;
                        }
                    }
                    if (!isMinimum) break;
                }

                if (isMinimum) {
                    m_flags[idx] |= TileFlags::Water;
                }
            }
        }
    }
}

void WorldGenerator::BuildChunks() {
    int numChunks = m_params.worldSizeChunks;

    for (int cy = 0; cy < numChunks; cy++) {
        for (int cx = 0; cx < numChunks; cx++) {
            Chunk chunk;
            chunk.cx = cx;
            chunk.cy = cy;

            for (int ty = 0; ty < CHUNK_SIZE; ty++) {
                for (int tx = 0; tx < CHUNK_SIZE; tx++) {
                    int wx = cx * CHUNK_SIZE + tx;
                    int wy = cy * CHUNK_SIZE + ty;
                    int worldIdx = WorldToTileIndex(wx, wy);
                    int chunkIdx = ty * CHUNK_SIZE + tx;

                    chunk.tiles[chunkIdx].height = m_height[worldIdx];
                    chunk.tiles[chunkIdx].biome =
                        static_cast<Biome>(m_biome[worldIdx]);
                    chunk.tiles[chunkIdx].flags = ComputeTileFlags(wx, wy);
                }
            }

            m_chunks[ChunkKey(cx, cy)] = chunk;
        }
    }
}

void WorldGenerator::GenerateStructures() {
    std::mt19937 rng(m_seed + 1000);
    std::uniform_real_distribution<float> chanceDist(0.0f, 1.0f);
    std::uniform_int_distribution<int> rotDist(0, 3);

    // First pass: Create building clusters (towns)
    for (int ty = 0; ty < 10; ty++) {
        for (int tx = 0; tx < 10; tx++) {
            if (chanceDist(rng) < 0.3f) { // 30% chance for a town
                int centerX = 100 + tx * (m_worldSize / 10);
                int centerY = 100 + ty * (m_worldSize / 10);
                
                // Check if location is suitable (plains or forest, not water)
                int idx = WorldToTileIndex(centerX, centerY);
                if (!InBounds(centerX, centerY)) continue;
                Biome biome = static_cast<Biome>(m_biome[idx]);
                if (m_flags[idx] & TileFlags::Water) continue;
                if (biome != Biome::Plains && biome != Biome::Forest) continue;
                
                // Create cluster of 5-12 houses
                int numBuildings = 5 + (rng() % 8);
                for (int i = 0; i < numBuildings; i++) {
                    int bx = centerX + (rng() % 30) - 15;
                    int by = centerY + (rng() % 30) - 15;
                    if (!InBounds(bx, by)) continue;
                    
                    Structure s;
                    s.type = StructureType::House;
                    s.x = bx;
                    s.y = by;
                    s.rotation = rotDist(rng);
                    s.destructible = false;
                    m_structures.push_back(s);
                }
            }
        }
    }

    // Second pass: Regular structure placement
    for (int y = 10; y < m_worldSize - 10; y++) {
        for (int x = 10; x < m_worldSize - 10; x++) {
            int idx = WorldToTileIndex(x, y);
            Biome biome = static_cast<Biome>(m_biome[idx]);
            uint8_t h = m_height[idx];

            // Skip water and mountains
            if (h < SEA_LEVEL || h > MOUNTAIN_LEVEL) continue;
            if (m_flags[idx] & TileFlags::Water) continue;

            float chance = chanceDist(rng);

            // Houses (less common outside towns)
            if (chance < m_params.structureDensity * 0.1f && IsFlat(x, y, 2)) {
                if (biome == Biome::Plains || biome == Biome::Forest) {
                    Structure s;
                    s.type = StructureType::House;
                    s.x = x;
                    s.y = y;
                    s.rotation = rotDist(rng);
                    s.destructible = false;
                    m_structures.push_back(s);
                    continue;
                }
            }

            // Dense tree forests
            if (chance < m_params.structureDensity * 8.0f) {
                if (biome == Biome::Forest) {
                    Structure s;
                    s.type = StructureType::Tree;
                    s.x = x;
                    s.y = y;
                    s.rotation = 0;
                    s.destructible = true;
                    m_structures.push_back(s);
                    continue;
                }
            }

            // Rocks in mountains and scattered in plains
            if (chance < m_params.structureDensity * 4.0f) {
                if (biome == Biome::Mountain || (biome == Biome::Plains && chanceDist(rng) < 0.3f)) {
                    Structure s;
                    s.type = StructureType::Rock;
                    s.x = x;
                    s.y = y;
                    s.rotation = 0;
                    s.destructible = false;
                    m_structures.push_back(s);
                    continue;
                }
            }

            // Bushes in plains and forests
            if (chance < m_params.structureDensity * 5.0f) {
                if (biome == Biome::Plains || biome == Biome::Forest) {
                    Structure s;
                    s.type = StructureType::Bush;
                    s.x = x;
                    s.y = y;
                    s.rotation = 0;
                    s.destructible = true;
                    m_structures.push_back(s);
                    continue;
                }
            }
        }
    }
}

void WorldGenerator::AnalyzePvPFairness() {
    // This will be implemented with proper LOS checks
    // For now, placeholder
}

void WorldGenerator::BalanceMap() {
    // Add cover in open areas
    std::mt19937 rng(m_seed + 2000);

    // Scan for open regions and add crates/walls
    for (int y = 50; y < m_worldSize - 50; y += 30) {
        for (int x = 50; x < m_worldSize - 50; x += 30) {
            float coverDensity = ComputeCoverDensity(x, y, 20);

            if (coverDensity < m_params.minCoverDensity) {
                // Add some cover structures
                for (int i = 0; i < 3; i++) {
                    Structure s;
                    s.type = StructureType::Crate;
                    s.x = x + (rng() % 10) - 5;
                    s.y = y + (rng() % 10) - 5;
                    s.rotation = 0;
                    s.destructible = true;
                    m_structures.push_back(s);
                }
            }
        }
    }
}

void WorldGenerator::GenerateSpawnPoints() {
    std::mt19937 rng(m_seed + 3000);

    // Generate spawn points in safe areas
    int numSpawns = 5;
    for (int i = 0; i < numSpawns; i++) {
        int attempts = 0;
        while (attempts < 100) {
            int x = rng() % m_worldSize;
            int y = rng() % m_worldSize;

            int idx = WorldToTileIndex(x, y);
            uint8_t h = m_height[idx];
            Biome biome = static_cast<Biome>(m_biome[idx]);

            // Good spawn: plains, flat, not water
            if (h >= BEACH_LEVEL && h < MOUNTAIN_LEVEL - 30 &&
                !(m_flags[idx] & TileFlags::Water) && biome == Biome::Plains &&
                IsFlat(x, y, 5)) {
                SpawnPoint sp;
                sp.x = x;
                sp.y = y;
                sp.safetyScore = 1.0f;  // TODO: compute based on LOS
                m_spawnPoints.push_back(sp);
                break;
            }

            attempts++;
        }
    }
}

Chunk* WorldGenerator::GetChunk(int cx, int cy) {
    auto it = m_chunks.find(ChunkKey(cx, cy));
    if (it != m_chunks.end()) {
        return &it->second;
    }
    return nullptr;
}

const Chunk* WorldGenerator::GetChunk(int cx, int cy) const {
    auto it = m_chunks.find(ChunkKey(cx, cy));
    if (it != m_chunks.end()) {
        return &it->second;
    }
    return nullptr;
}

Tile* WorldGenerator::GetTile(int x, int y) {
    if (!InBounds(x, y)) return nullptr;

    int cx = x / CHUNK_SIZE;
    int cy = y / CHUNK_SIZE;
    int tx = x % CHUNK_SIZE;
    int ty = y % CHUNK_SIZE;

    Chunk* chunk = GetChunk(cx, cy);
    if (!chunk) return nullptr;

    return &chunk->tiles[ty * CHUNK_SIZE + tx];
}

const Tile* WorldGenerator::GetTile(int x, int y) const {
    if (!InBounds(x, y)) return nullptr;

    int cx = x / CHUNK_SIZE;
    int cy = y / CHUNK_SIZE;
    int tx = x % CHUNK_SIZE;
    int ty = y % CHUNK_SIZE;

    const Chunk* chunk = GetChunk(cx, cy);
    if (!chunk) return nullptr;

    return &chunk->tiles[ty * CHUNK_SIZE + tx];
}

std::vector<Rect> WorldGenerator::GreedyMerge(const Chunk& chunk) const {
    bool used[CHUNK_SIZE][CHUNK_SIZE] = {};
    std::vector<Rect> rects;

    for (int y = 0; y < CHUNK_SIZE; y++) {
        for (int x = 0; x < CHUNK_SIZE; x++) {
            if (used[y][x]) continue;

            const Tile& tile = chunk.tiles[y * CHUNK_SIZE + x];
            if (!(tile.flags & TileFlags::Solid)) continue;

            // Expand horizontally
            int w = 1;
            while (x + w < CHUNK_SIZE && !used[y][x + w]) {
                const Tile& nextTile = chunk.tiles[y * CHUNK_SIZE + (x + w)];
                if (!(nextTile.flags & TileFlags::Solid)) break;
                w++;
            }

            // Expand vertically
            int h = 1;
            bool canExpand = true;
            while (y + h < CHUNK_SIZE && canExpand) {
                for (int i = 0; i < w; i++) {
                    if (used[y + h][x + i]) {
                        canExpand = false;
                        break;
                    }
                    const Tile& nextTile =
                        chunk.tiles[(y + h) * CHUNK_SIZE + (x + i)];
                    if (!(nextTile.flags & TileFlags::Solid)) {
                        canExpand = false;
                        break;
                    }
                }
                if (canExpand) h++;
            }

            // Mark as used
            for (int dy = 0; dy < h; dy++) {
                for (int dx = 0; dx < w; dx++) {
                    used[y + dy][x + dx] = true;
                }
            }

            rects.push_back({x, y, w, h});
        }
    }

    return rects;
}

void WorldGenerator::BuildChunkPhysics(Chunk* chunk, b2World& physicsWorld) {
    if (chunk->physicsBuilt) return;

    auto rects = GreedyMerge(*chunk);
    if (rects.empty()) return;

    b2BodyDef def;
    def.type = b2_staticBody;
    def.position.x = chunk->cx * CHUNK_SIZE;
    def.position.y = chunk->cy * CHUNK_SIZE;

    b2Body* body = physicsWorld.CreateBody(&def);

    for (auto& r : rects) {
        b2PolygonShape shape;
        float centerX = r.x + r.w * 0.5f;
        float centerY = r.y + r.h * 0.5f;
        shape.SetAsBox(r.w * 0.5f, r.h * 0.5f, b2Vec2(centerX, centerY), 0);

        b2FixtureDef fixtureDef;
        fixtureDef.shape = &shape;
        fixtureDef.filter.categoryBits = CAT_WALL;
        fixtureDef.filter.maskBits = MASK_PLAYER_MOVE | MASK_BULLET;

        body->CreateFixture(&fixtureDef);
    }

    chunk->physicsBuilt = true;
}

// Helper functions

int WorldGenerator::WorldToTileIndex(int x, int y) const {
    return y * m_worldSize + x;
}

bool WorldGenerator::InBounds(int x, int y) const {
    return x >= 0 && x < m_worldSize && y >= 0 && y < m_worldSize;
}

std::pair<int, int> WorldGenerator::FindLowestNeighbor(int x, int y) const {
    static const int dx[] = {-1, 0, 1, -1, 1, -1, 0, 1};
    static const int dy[] = {-1, -1, -1, 0, 0, 1, 1, 1};

    int bestX = x, bestY = y;
    uint8_t lowestHeight = m_height[WorldToTileIndex(x, y)];

    for (int i = 0; i < 8; i++) {
        int nx = x + dx[i];
        int ny = y + dy[i];

        if (!InBounds(nx, ny)) continue;

        uint8_t h = m_height[WorldToTileIndex(nx, ny)];
        if (h < lowestHeight) {
            lowestHeight = h;
            bestX = nx;
            bestY = ny;
        }
    }

    return {bestX, bestY};
}

bool WorldGenerator::IsFlat(int x, int y, int radius) const {
    if (!InBounds(x, y)) return false;

    uint8_t centerHeight = m_height[WorldToTileIndex(x, y)];
    constexpr uint8_t threshold = 10;

    for (int dy = -radius; dy <= radius; dy++) {
        for (int dx = -radius; dx <= radius; dx++) {
            int nx = x + dx;
            int ny = y + dy;
            if (!InBounds(nx, ny)) continue;

            uint8_t h = m_height[WorldToTileIndex(nx, ny)];
            if (std::abs(static_cast<int>(h) - static_cast<int>(centerHeight)) >
                threshold) {
                return false;
            }
        }
    }

    return true;
}

bool WorldGenerator::NearWater(int x, int y, int radius) const {
    for (int dy = -radius; dy <= radius; dy++) {
        for (int dx = -radius; dx <= radius; dx++) {
            int nx = x + dx;
            int ny = y + dy;
            if (!InBounds(nx, ny)) continue;

            if (m_flags[WorldToTileIndex(nx, ny)] & TileFlags::Water) {
                return true;
            }
        }
    }
    return false;
}

uint8_t WorldGenerator::ComputeTileFlags(int x, int y) const {
    uint8_t flags = m_flags[WorldToTileIndex(x, y)];

    // Add solid flag for mountains and high terrain
    uint8_t h = m_height[WorldToTileIndex(x, y)];
    if (h > MOUNTAIN_LEVEL - 20) {
        flags |= TileFlags::Solid;
    }

    return flags;
}

float WorldGenerator::ComputeSightlineLength(int x, int y, float angle) const {
    // TODO: Implement proper raycasting
    return 0.0f;
}

float WorldGenerator::ComputeCoverDensity(int x, int y, int radius) const {
    int total = 0;
    int coverCount = 0;

    for (int dy = -radius; dy <= radius; dy++) {
        for (int dx = -radius; dx <= radius; dx++) {
            int nx = x + dx;
            int ny = y + dy;
            if (!InBounds(nx, ny)) continue;

            total++;
            uint8_t flags = m_flags[WorldToTileIndex(nx, ny)];
            if (flags & (TileFlags::Solid | TileFlags::Cover)) {
                coverCount++;
            }
        }
    }

    return total > 0 ? static_cast<float>(coverCount) / total : 0.0f;
}
