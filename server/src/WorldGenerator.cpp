#include "WorldGenerator.hpp"
#include "WorldGeneratorConstants.hpp"
#include "common/enums.hpp"

#include <box2d/b2_body.h>
#include <box2d/b2_fixture.h>
#include <box2d/b2_polygon_shape.h>

#include <algorithm>
#include <cmath>
#include <iostream>
#include <random>
#include <unordered_set>

#include "GameServer.hpp"
#include "ecs/EntityManager.hpp"

using namespace WorldGenConstants;

// ============================================================================
// SlopeMap Implementation
// ============================================================================

void SlopeMap::Compute(const std::vector<float>& heightMap) {
    // Calculate gradients using central differences
    for (int y = 0; y < m_worldSize; y++) {
        for (int x = 0; x < m_worldSize; x++) {
            const int idx = y * m_worldSize + x;
            
            // Central difference for X gradient
            if (x > 0 && x < m_worldSize - 1) {
                const float hLeft = heightMap[y * m_worldSize + (x - 1)];
                const float hRight = heightMap[y * m_worldSize + (x + 1)];
                m_slopeX[idx] = (hRight - hLeft) * 0.5f;
            } else {
                m_slopeX[idx] = 0.0f;
            }
            
            // Central difference for Y gradient
            if (y > 0 && y < m_worldSize - 1) {
                const float hUp = heightMap[(y - 1) * m_worldSize + x];
                const float hDown = heightMap[(y + 1) * m_worldSize + x];
                m_slopeY[idx] = (hDown - hUp) * 0.5f;
            } else {
                m_slopeY[idx] = 0.0f;
            }
        }
    }
}

// ============================================================================
// ErosionBrush - Precomputed brush for performance
// ============================================================================

struct ErosionBrush {
    std::vector<std::pair<int, float>> offsets;  // (offset, weight)
    
    ErosionBrush(int radius, int worldSize) {
        for (int ey = -radius; ey <= radius; ey++) {
            for (int ex = -radius; ex <= radius; ex++) {
                const float dist = std::sqrt(static_cast<float>(ex * ex + ey * ey));
                if (dist <= radius) {
                    const float weight = 1.0f - (dist / radius);
                    const int offset = ey * worldSize + ex;
                    offsets.push_back({offset, weight});
                }
            }
        }
    }
};

// ============================================================================
// Eroder Implementation - Optimized
// ============================================================================

void Eroder::Erode(std::vector<float>& heightMap, int numDroplets, int maxSteps) {
    std::uniform_real_distribution<float> posDist(0.0f, static_cast<float>(m_worldSize - 1));
    
    // Pre-compute erosion brush for performance
    ErosionBrush brush(EROSION_BRUSH_RADIUS, m_worldSize);
    
    // Pre-compute slope map for faster lookups
    SlopeMap slopeMap(m_worldSize);
    
    for (int drop = 0; drop < numDroplets; drop++) {
        // Recompute slopes periodically to reflect terrain changes
        if (drop % SLOPE_RECOMPUTE_INTERVAL == 0) {
            slopeMap.Compute(heightMap);
        }
        
        // Spawn droplet at random position
        Droplet d;
        d.x = posDist(m_rng);
        d.y = posDist(m_rng);
        d.dx = 0.0f;
        d.dy = 0.0f;
        d.velocity = 1.0f;
        d.water = 1.0f;
        d.sediment = 0.0f;
        
        // Simulate droplet flow
        for (int step = 0; step < maxSteps; step++) {
            const int xi = static_cast<int>(d.x);
            const int yi = static_cast<int>(d.y);
            
            // Out of bounds check
            if (xi < 0 || xi >= m_worldSize - 1 || yi < 0 || yi >= m_worldSize - 1) {
                break;
            }
            
            const int idx = yi * m_worldSize + xi;
            const float oldHeight = heightMap[idx];
            
            // Calculate gradient (downhill direction)
            const float gradX = slopeMap.GetSlopeX(xi, yi);
            const float gradY = slopeMap.GetSlopeY(xi, yi);
            
            // Update direction with inertia
            d.dx = d.dx * EROSION_INERTIA - gradX * (1.0f - EROSION_INERTIA);
            d.dy = d.dy * EROSION_INERTIA - gradY * (1.0f - EROSION_INERTIA);
            
            // Normalize direction
            const float len = std::sqrt(d.dx * d.dx + d.dy * d.dy);
            if (len < 0.001f) {
                break;  // Stuck in local minimum
            }
            d.dx /= len;
            d.dy /= len;
            
            // Move droplet
            d.x += d.dx;
            d.y += d.dy;
            
            // New position check
            const int newXi = static_cast<int>(d.x);
            const int newYi = static_cast<int>(d.y);
            if (newXi < 0 || newXi >= m_worldSize || newYi < 0 || newYi >= m_worldSize) {
                break;
            }
            
            const int newIdx = newYi * m_worldSize + newXi;
            const float newHeight = heightMap[newIdx];
            const float heightDelta = newHeight - oldHeight;
            
            // Calculate sediment capacity
            const float slope = std::max(MIN_EROSION_SLOPE, -heightDelta);
            const float capacity = std::max(-heightDelta, MIN_EROSION_SLOPE) * d.velocity * d.water * EROSION_CAPACITY;
            
            // Erode or deposit
            if (d.sediment > capacity || heightDelta > 0.0f) {
                // Deposit sediment
                const float amountToDeposit = (heightDelta > 0.0f) 
                    ? std::min(heightDelta, d.sediment) 
                    : (d.sediment - capacity) * DEPOSITION_RATE;
                
                d.sediment -= amountToDeposit;
                heightMap[idx] += amountToDeposit;
            } else {
                // Erode terrain with precomputed brush
                const float amountToErode = std::min((capacity - d.sediment) * EROSION_RATE, -heightDelta);
                
                // Apply erosion using precomputed brush
                for (const auto& [offset, weight] : brush.offsets) {
                    const int erodeIdx = idx + offset;
                    
                    // Bounds check
                    if (erodeIdx >= 0 && erodeIdx < m_worldSize * m_worldSize) {
                        const int erodeX = erodeIdx % m_worldSize;
                        const int erodeY = erodeIdx / m_worldSize;
                        
                        // Additional bounds check for wrapped indices
                        if (std::abs(erodeX - xi) <= EROSION_BRUSH_RADIUS &&
                            std::abs(erodeY - yi) <= EROSION_BRUSH_RADIUS) {
                            heightMap[erodeIdx] -= amountToErode * weight * 0.1f;
                        }
                    }
                }
                
                d.sediment += amountToErode;
            }
            
            // Update velocity and evaporate water
            d.velocity = std::sqrt(d.velocity * d.velocity + heightDelta * EROSION_GRAVITY);
            d.water *= (1.0f - EVAPORATION_RATE);
            
            if (d.water < 0.01f) {
                break;  // Droplet dried up
            }
        }
    }
}

// ============================================================================
// WorldGenerator Implementation
// ============================================================================

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
    std::cout << "World size: " << m_worldSize << "x" << m_worldSize << " tiles" << std::endl;

    // Allocate world arrays
    const size_t totalTiles = m_worldSize * m_worldSize;
    m_height.resize(totalTiles);
    m_biome.resize(totalTiles);
    m_flags.resize(totalTiles);
    m_flowDirection.resize(totalTiles, WorldGenerator::NO_FLOW);
    
    // Allocate float working buffers
    m_heightFloat.resize(totalTiles);
    m_precipitationFloat.resize(totalTiles);
    m_temperatureFloat.resize(totalTiles);

    // Initialize noise generators with deterministic seeds derived from master seed
    m_heightNoise = PerlinNoise(m_seed);
    m_moistureNoise = PerlinNoise(m_seed + 1000);
    m_temperatureNoise = PerlinNoise(m_seed + 2000);

    // Generation pipeline - Volcanic Island Method
    std::cout << "Generating heightmap (volcanic island)..." << std::endl;
    GenerateHeight();

    std::cout << "Generating precipitation (rain shadow)..." << std::endl;
    GeneratePrecipitation();
    
    std::cout << "Generating temperature (latitude + elevation)..." << std::endl;
    GenerateTemperature();
    
    // !!Apply erosion BEFORE biome generation!!
    std::cout << "Applying hydraulic erosion..." << std::endl;
    ApplyErosion();
    
    std::cout << "Generating biomes (15-biome system)..." << std::endl;
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
    
    // Free float buffers after generation
    m_heightFloat.clear();
    m_heightFloat.shrink_to_fit();
    m_precipitationFloat.clear();
    m_precipitationFloat.shrink_to_fit();
    m_temperatureFloat.clear();
    m_temperatureFloat.shrink_to_fit();

    std::cout << "World generation complete!" << std::endl;
    std::cout << "Chunks: " << m_chunks.size() << std::endl;
    std::cout << "Rivers: " << m_rivers.size() << std::endl;
    std::cout << "Structures: " << m_structures.size() << std::endl;
    std::cout << "Spawn points: " << m_spawnPoints.size() << std::endl;
}

void WorldGenerator::GenerateHeight() {
    // Volcanic Island Generation Method
    // Step 1: Create radial gradient (cone shape)
    std::vector<float> radialGradient(m_worldSize * m_worldSize);
    const float centerX = m_worldSize * ISLAND_CENTER_X_RATIO;
    const float centerY = m_worldSize * ISLAND_CENTER_Y_RATIO;
    const float radius = m_worldSize * ISLAND_RADIUS_RATIO;
    GenerateRadialGradient(radialGradient, centerX, centerY, radius, 1.0f, -1.0f);
    
    // Step 2: Create fractal noise (organic bumps)
    std::vector<float> fractalNoise(m_worldSize * m_worldSize);
    GenerateFractalNoise(fractalNoise, m_seed, FRACTAL_OCTAVES);
    
    // Step 3: Blend with weighted mean
    WeightedMean(m_heightFloat, radialGradient, fractalNoise, HEIGHT_GRADIENT_WEIGHT);
    
    // Convert float [-1,1] to uint8 [0,255]
    for (size_t i = 0; i < m_heightFloat.size(); i++) {
        // Scale from [-1,1] to [0,255]
        float normalized = (m_heightFloat[i] + 1.0f) * 0.5f;  // [0,1]
        normalized = std::clamp(normalized, 0.0f, 1.0f);
        m_height[i] = static_cast<uint8_t>(normalized * 255.0f);
    }
}

void WorldGenerator::GeneratePrecipitation() {
    // Rain Shadow Effect
    const float centerX = m_worldSize * ISLAND_CENTER_X_RATIO;
    const float centerY = m_worldSize * ISLAND_CENTER_Y_RATIO;
    const float radius = m_worldSize * RAIN_SHADOW_RADIUS_RATIO;
    
    // Random wind direction
    std::mt19937 rng(m_seed + 3000);
    std::uniform_real_distribution<float> dist(
        -m_worldSize * WIND_OFFSET_RANGE,
        m_worldSize * WIND_OFFSET_RANGE
    );
    const float windX = dist(rng);
    const float windY = dist(rng);
    
    std::vector<float> gradient1(m_worldSize * m_worldSize);
    std::vector<float> gradient2(m_worldSize * m_worldSize);
    
    GenerateRadialGradient(gradient1, centerX, centerY, radius, 1.0f, 0.0f);
    GenerateRadialGradient(gradient2, centerX + windX, centerY + windY, radius, 1.0f, 0.0f);
    
    // Subtract to create rain shadow
    std::vector<float> rainShadow(m_worldSize * m_worldSize);
    Subtract(rainShadow, gradient1, gradient2);
    
    // Add fractal noise
    std::vector<float> fractalNoise(m_worldSize * m_worldSize);
    GenerateFractalNoise(fractalNoise, m_seed + 1000, FRACTAL_OCTAVES);
    
    // Weighted mean
    WeightedMean(m_precipitationFloat, rainShadow, fractalNoise, PRECIPITATION_NOISE_WEIGHT);
}

void WorldGenerator::GenerateTemperature() {
    // North-South Temperature Gradient + Elevation Cooling
    std::vector<float> linearGradient(m_worldSize * m_worldSize);
    GenerateLinearGradient(linearGradient, -1.0f, 1.0f);
    
    // Add fractal noise
    std::vector<float> fractalNoise(m_worldSize * m_worldSize);
    GenerateFractalNoise(fractalNoise, m_seed + 2000, FRACTAL_OCTAVES);
    
    // Weighted mean
    WeightedMean(m_temperatureFloat, linearGradient, fractalNoise, TEMPERATURE_GRADIENT_WEIGHT);
    
    // Adjust for elevation (mountains are cold)
    for (size_t i = 0; i < m_temperatureFloat.size(); i++) {
        if (m_heightFloat[i] > 0.0f) {
            m_temperatureFloat[i] -= (m_heightFloat[i] - ELEVATION_COOLING_OFFSET) * ELEVATION_COOLING_FACTOR;
            m_temperatureFloat[i] = std::clamp(m_temperatureFloat[i], -1.0f, 1.0f);
        }
    }
}

void WorldGenerator::GenerateBiomes() {
    // 15-Biome System: Temperature (3) x Moisture (5)
    for (int y = 0; y < m_worldSize; y++) {
        for (int x = 0; x < m_worldSize; x++) {
            const int idx = WorldToTileIndex(x, y);
            
            const float elevation = m_heightFloat[idx];
            const float temperature = m_temperatureFloat[idx];
            const float precipitation = m_precipitationFloat[idx];
            
            Biome biome;
            
            // Ocean biomes
            if (elevation < SEA_LEVEL_NORMALIZED) {
                if (temperature > TEMP_HOT_THRESHOLD) {
                    biome = Biome::TropicalOcean;
                } else if (temperature < TEMP_COLD_THRESHOLD) {
                    biome = Biome::ArcticOcean;
                } else {
                    biome = Biome::TemperateOcean;
                }
                m_flags[idx] |= TileFlags::Water;
            }
            // Special: Beach (just above sea level)
            else if (elevation < BEACH_LEVEL_NORMALIZED) {
                biome = Biome::Beach;
            }
            // Special: Mountain (very high elevation)
            else if (elevation > MOUNTAIN_LEVEL_NORMALIZED) {
                biome = Biome::Mountain;
            }
            // Special: Glacier
            else if (temperature < TEMP_GLACIER_THRESHOLD) {
                biome = Biome::Glacier;
            }
            // Special: Snow
            else if (temperature < TEMP_SNOW_THRESHOLD) {
                biome = Biome::Snow;
            }
            // Cold biomes
            else if (temperature < TEMP_COLD_THRESHOLD) {
                if (precipitation < PRECIP_LOW) {
                    biome = Biome::ColdDesert;
                } else if (precipitation < PRECIP_MED_LOW) {
                    biome = Biome::Tundra;
                } else if (precipitation < PRECIP_MED) {
                    biome = Biome::TaigaFrontier;
                } else if (precipitation < PRECIP_HIGH) {
                    biome = Biome::Taiga;
                } else {
                    biome = Biome::TaigaRainforest;
                }
            }
            // Hot biomes
            else if (temperature > TEMP_HOT_THRESHOLD) {
                if (precipitation < PRECIP_LOW) {
                    biome = Biome::HotDesert;
                } else if (precipitation < PRECIP_MED_LOW) {
                    biome = Biome::HotSavanna;
                } else if (precipitation < PRECIP_MED) {
                    biome = Biome::TropicalFrontier;
                } else if (precipitation < PRECIP_HIGH) {
                    biome = Biome::TropicalForest;
                } else {
                    biome = Biome::TropicalRainforest;
                }
            }
            // Temperate biomes
            else {
                if (precipitation < PRECIP_LOW) {
                    biome = Biome::TemperateDesert;
                } else if (precipitation < PRECIP_MED_LOW) {
                    biome = Biome::TemperateGrassland;
                } else if (precipitation < PRECIP_MED) {
                    biome = Biome::TemperateFrontier;
                } else if (precipitation < PRECIP_HIGH) {
                    biome = Biome::TemperateForest;
                } else {
                    biome = Biome::TemperateRainforest;
                }
            }
            
            m_biome[idx] = static_cast<uint8_t>(biome);
        }
    }
}

void WorldGenerator::ApplyErosion() {
    std::cout << "Applying hydraulic erosion..." << std::endl;
    
    // Compute slope map for fast gradient lookups
    SlopeMap slopeMap(m_worldSize);
    slopeMap.Compute(m_heightFloat);
    
    // Run erosion simulation
    Eroder eroder(m_worldSize, m_seed + 3000);
    
    eroder.Erode(m_heightFloat, DEFAULT_DROPLET_COUNT, DEFAULT_MAX_STEPS);
    
    // Convert float heightmap back to uint8
    for (size_t i = 0; i < m_heightFloat.size(); i++) {
        const float normalized = std::clamp((m_heightFloat[i] + 1.0f) * 0.5f, 0.0f, 1.0f);
        m_height[i] = static_cast<uint8_t>(normalized * 255);
    }
    
    std::cout << "  Erosion complete (" << DEFAULT_DROPLET_COUNT << " droplets)" << std::endl;
}

// Helper Functions

void WorldGenerator::GenerateRadialGradient(std::vector<float>& output, float centerX, float centerY, float radius, float centerValue, float edgeValue) {
    const float radiusSquared = radius * radius;
    const float invRadiusSquared = 1.0f / radiusSquared;
    
    for (int y = 0; y < m_worldSize; y++) {
        for (int x = 0; x < m_worldSize; x++) {
            const int idx = WorldToTileIndex(x, y);
            
            const float dx = static_cast<float>(x) - centerX;
            const float dy = static_cast<float>(y) - centerY;
            const float distSquared = dx * dx + dy * dy;
            
            // Compute gradient value
            const float t = std::clamp(distSquared * invRadiusSquared, 0.0f, 1.0f);
            output[idx] = centerValue + (edgeValue - centerValue) * t;
        }
    }
}

void WorldGenerator::GenerateLinearGradient(std::vector<float>& output, float startValue, float endValue) {
    const float scale = 1.0f / static_cast<float>(m_worldSize - 1);
    
    for (int y = 0; y < m_worldSize; y++) {
        const float t = static_cast<float>(y) * scale;
        const float value = startValue + (endValue - startValue) * t;
        
        for (int x = 0; x < m_worldSize; x++) {
            const int idx = WorldToTileIndex(x, y);
            output[idx] = value;
        }
    }
}

void WorldGenerator::GenerateFractalNoise(std::vector<float>& output, uint32_t seed, int octaves) {
    PerlinNoise noise(seed);
    
    // Cache-optimized tiled processing
    constexpr int TILE_SIZE = NOISE_TILE_SIZE;
    
    for (int ty = 0; ty < m_worldSize; ty += TILE_SIZE) {
        for (int tx = 0; tx < m_worldSize; tx += TILE_SIZE) {
            // Process tiles for better cache locality
            const int maxY = std::min(ty + TILE_SIZE, m_worldSize);
            const int maxX = std::min(tx + TILE_SIZE, m_worldSize);
            
            for (int y = ty; y < maxY; y++) {
                for (int x = tx; x < maxX; x++) {
                    const int idx = WorldToTileIndex(x, y);
                    
                    float total = 0.0f;
                    const float fx = static_cast<float>(x);
                    const float fy = static_cast<float>(y);
                    
                    for (int i = 0; i < octaves && i < FRACTAL_OCTAVES; i++) {
                        total += noise.noise(fx * FRACTAL_FREQUENCIES[i], fy * FRACTAL_FREQUENCIES[i]) * FRACTAL_WEIGHTS[i];
                    }
                    
                    output[idx] = total;
                }
            }
        }
    }
}

void WorldGenerator::WeightedMean(std::vector<float>& output, const std::vector<float>& mapA, const std::vector<float>& mapB, float weight) {
    const float invWeight = 1.0f / weight;
    
    for (size_t i = 0; i < mapA.size(); i++) {
        output[i] = ((mapA[i] * weight) + (mapB[i] * invWeight)) * 0.5f;
    }
}

void WorldGenerator::Subtract(std::vector<float>& output, const std::vector<float>& mapA, const std::vector<float>& mapB) {
    for (size_t i = 0; i < mapA.size(); i++) {
        output[i] = mapA[i] - mapB[i];
    }
}

void WorldGenerator::GenerateRivers() {
    // Generate a single meandering river from west to east across the island
    River river;
    std::vector<std::pair<int, int>> pathWithFlow;
    
    // Use Perlin noise to guide river with gentle meanders
    PerlinNoise riverNoise(m_seed + 100);
    
    // Start from west edge at middle height
    const int startX = 0;
    const int startY = m_worldSize / 2;
    
    // Target east edge with slight vertical offset for interest
    const int targetX = m_worldSize - 1;
    const int targetY = m_worldSize / 2 + m_worldSize / 8;  // Slight diagonal
    
    int x = startX;
    int y = startY;
    
    // Optimized: Use uint32_t packed keys for faster hash lookup
    std::unordered_set<uint32_t> visited;
    
    while (x < targetX && river.path.size() < RIVER_MAX_LENGTH) {
        // Pack x,y into single uint32_t (assumes worldSize < 65536)
        const uint32_t key = (static_cast<uint32_t>(x) << 16) | static_cast<uint32_t>(y);
        if (visited.count(key)) break;
        visited.insert(key);
        
        river.path.push_back({x, y});
        pathWithFlow.push_back({x, y});
        
        // Calculate direction to target
        const float dx = static_cast<float>(targetX - x);
        const float dy = static_cast<float>(targetY - y);
        const float targetAngle = std::atan2(dy, dx);
        
        // Sample Perlin noise for meandering offset
        const float noiseValue = riverNoise.noise(
            static_cast<float>(x) * RIVER_NOISE_FREQUENCY,
            static_cast<float>(y) * RIVER_NOISE_FREQUENCY
        );
        const float noiseAngle = noiseValue * static_cast<float>(M_PI);  // Range: [-π, π]
        
        // Blend target direction with noise
        const float angle = RIVER_TARGET_BIAS * targetAngle + RIVER_NOISE_BIAS * noiseAngle;
        
        // Step in computed direction
        int nextX = x + static_cast<int>(std::round(std::cos(angle) * 2.0f));
        int nextY = y + static_cast<int>(std::round(std::sin(angle) * 2.0f));
        
        // Clamp to bounds
        nextX = std::clamp(nextX, 0, m_worldSize - 1);
        nextY = std::clamp(nextY, 0, m_worldSize - 1);
        
        // Always advance at least 1 tile east to guarantee progress
        if (nextX <= x) {
            nextX = x + 1;
        }
        
        x = nextX;
        y = nextY;
    }
    
    // Add final segment to reach east edge
    river.path.push_back({targetX, y});
    pathWithFlow.push_back({targetX, y});
    
    m_rivers.push_back(river);
    std::cout << "Main river created with " << river.path.size() << " points, splitting the island" << std::endl;
    
    // Apply river to map with width and flow direction
    ApplyRiverToMap(pathWithFlow);
}

void WorldGenerator::ApplyRiverToMap(const std::vector<std::pair<int, int>>& path) {
    if (path.empty()) return;
    
    // Mark river tiles and calculate flow direction
    for (size_t i = 0; i < path.size(); i++) {
        const int x = path[i].first;
        const int y = path[i].second;

        // Calculate flow direction from this tile to next
        int nextX = x;
        int nextY = y;
        if (i + 1 < path.size()) {
            nextX = path[i + 1].first;
            nextY = path[i + 1].second;
        }

        // Calculate angle in radians
        const float dx = static_cast<float>(nextX - x);
        const float dy = static_cast<float>(nextY - y);
        const float angle = std::atan2(dy, dx);

        // Convert angle [-π, π] to 0-255 range
        const uint8_t flowDir = static_cast<uint8_t>(((angle + static_cast<float>(M_PI)) / (2.0f * static_cast<float>(M_PI))) * 255.0f);

        // Mark the center tile as water and set flow direction
        if (InBounds(x, y)) {
            const int idx = WorldToTileIndex(x, y);
            m_flags[idx] |= TileFlags::Water;
            m_flowDirection[idx] = flowDir;
        }

        // Expand river width - create thick river
        for (int dy = -RIVER_WIDTH; dy <= RIVER_WIDTH; dy++) {
            for (int dx = -RIVER_WIDTH; dx <= RIVER_WIDTH; dx++) {
                const int nx = x + dx;
                const int ny = y + dy;

                if (!InBounds(nx, ny)) continue;

                const int nIdx = WorldToTileIndex(nx, ny);
                
                // Distance from center
                const float dist = std::sqrt(static_cast<float>(dx * dx + dy * dy));

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
            const int idx = WorldToTileIndex(x, y);

            // If this is water, check neighbors for edge marking
            if (m_flags[idx] & TileFlags::Water) {
                // Check if this is an edge by looking for non-water neighbors
                bool isEdge = false;
                for (int dy = -1; dy <= 1; dy++) {
                    for (int dx = -1; dx <= 1; dx++) {
                        if (dx == 0 && dy == 0) continue;
                        const int nIdx = WorldToTileIndex(x + dx, y + dy);
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
                    const uint8_t height = m_height[idx];
                    // Water edges become beach or wetland depending on height
                    if (height < SEA_LEVEL + 15) {
                        m_biome[idx] = static_cast<uint8_t>(Biome::Beach);
                    } else {
                        // Use wetland biome (rainforest) for river edges
                        m_biome[idx] = static_cast<uint8_t>(Biome::TemperateRainforest);
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
            const int idx = WorldToTileIndex(x, y);
            const uint8_t h = m_height[idx];

            if (h >= SEA_LEVEL + 5 && h < SEA_LEVEL + 20) {
                // Check if this is a local minimum
                bool isMinimum = true;
                for (int dy = -1; dy <= 1; dy++) {
                    for (int dx = -1; dx <= 1; dx++) {
                        if (dx == 0 && dy == 0) continue;
                        const int nIdx = WorldToTileIndex(x + dx, y + dy);
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
    const int numChunks = m_params.worldSizeChunks;

    for (int cy = 0; cy < numChunks; cy++) {
        for (int cx = 0; cx < numChunks; cx++) {
            Chunk chunk;
            chunk.cx = cx;
            chunk.cy = cy;

            for (int ty = 0; ty < CHUNK_SIZE; ty++) {
                for (int tx = 0; tx < CHUNK_SIZE; tx++) {
                    const int wx = cx * CHUNK_SIZE + tx;
                    const int wy = cy * CHUNK_SIZE + ty;
                    const int worldIdx = WorldToTileIndex(wx, wy);
                    const int chunkIdx = ty * CHUNK_SIZE + tx;

                    chunk.tiles[chunkIdx].height = m_height[worldIdx];
                    chunk.tiles[chunkIdx].biome = static_cast<Biome>(m_biome[worldIdx]);
                    chunk.tiles[chunkIdx].flags = ComputeTileFlags(wx, wy);
                }
            }

            m_chunks[ChunkKey(cx, cy)] = chunk;
        }
    }
}

// Structure generation with spatial grid for overlap prevention
struct SpatialGrid {
    std::unordered_map<uint32_t, bool> occupied;
    int cellSize;
    int worldSize;
    
    SpatialGrid(int worldSize, int cellSize) : worldSize(worldSize), cellSize(cellSize) {}
    
    uint32_t getKey(int x, int y) const {
        const int cx = x / cellSize;
        const int cy = y / cellSize;
        return (static_cast<uint32_t>(cx) << 16) | static_cast<uint32_t>(cy);
    }
    
    bool isOccupied(int x, int y, int radius) const {
        for (int dy = -radius; dy <= radius; dy++) {
            for (int dx = -radius; dx <= radius; dx++) {
                const uint32_t key = getKey(x + dx * cellSize, y + dy * cellSize);
                if (occupied.count(key)) return true;
            }
        }
        return false;
    }
    
    void occupy(int x, int y) {
        occupied[getKey(x, y)] = true;
    }
};

void WorldGenerator::GenerateStructures() {
    std::mt19937 rng(m_seed + 4000);
    std::uniform_real_distribution<float> chanceDist(0.0f, 1.0f);
    std::uniform_int_distribution<int> rotDist(0, 3);

    // Spatial grid for overlap prevention (10-tile cells)
    SpatialGrid grid(m_worldSize, 10);

    // Combined pass: towns and biome-specific structures
    for (int y = 10; y < m_worldSize - 10; y++) {
        for (int x = 10; x < m_worldSize - 10; x++) {
            const int idx = WorldToTileIndex(x, y);
            const Biome biome = static_cast<Biome>(m_biome[idx]);
            const uint8_t h = m_height[idx];

            // Skip water and extreme elevations
            if (h < SEA_LEVEL || h > MOUNTAIN_LEVEL) continue;
            if (m_flags[idx] & TileFlags::Water) continue;
            
            // Skip if occupied
            if (grid.isOccupied(x, y, 1)) continue;

            const float chance = chanceDist(rng);
            
            // Towns (checked every 50 tiles for efficiency)
            if (x % 50 == 0 && y % 50 == 0 && chance < TOWN_CHANCE) {
                if (biome == Biome::TemperateGrassland || 
                    biome == Biome::TemperateFrontier ||
                    biome == Biome::HotSavanna) {
                    // Create cluster of buildings
                    const int numBuildings = TOWN_MIN_BUILDINGS + (rng() % (TOWN_MAX_BUILDINGS - TOWN_MIN_BUILDINGS + 1));
                    for (int i = 0; i < numBuildings; i++) {
                        const int bx = x + (rng() % (TOWN_SPREAD_RADIUS * 2)) - TOWN_SPREAD_RADIUS;
                        const int by = y + (rng() % (TOWN_SPREAD_RADIUS * 2)) - TOWN_SPREAD_RADIUS;
                        if (!InBounds(bx, by) || grid.isOccupied(bx, by, 0)) continue;
                        
                        Structure s;
                        s.type = StructureType::House;
                        s.x = bx;
                        s.y = by;
                        s.rotation = rotDist(rng);
                        s.destructible = false;
                        m_structures.push_back(s);
                        grid.occupy(bx, by);
                    }
                    continue;
                }
            }

            // Get precipitation value (for tree density)
            const float precipitation = (idx < m_precipitationFloat.size()) 
                ? m_precipitationFloat[idx] : 0.0f;

            // Trees: Density based on biome type
            float treeDensity = 0.0f;
            
            if (biome == Biome::TemperateRainforest || 
                biome == Biome::TropicalRainforest ||
                biome == Biome::TaigaRainforest) {
                treeDensity = m_params.structureDensity * RAINFOREST_TREE_DENSITY;
            }
            else if (biome == Biome::TemperateForest || 
                     biome == Biome::TropicalForest ||
                     biome == Biome::Taiga) {
                treeDensity = m_params.structureDensity * FOREST_TREE_DENSITY;
            }
            else if (biome == Biome::TemperateFrontier || 
                     biome == Biome::TropicalFrontier ||
                     biome == Biome::TaigaFrontier ||
                     biome == Biome::HotSavanna) {
                treeDensity = m_params.structureDensity * FRONTIER_TREE_DENSITY;
            }
            
            if (chance < treeDensity) {
                Structure s;
                s.type = StructureType::Tree;
                s.x = x;
                s.y = y;
                s.rotation = 0;
                s.destructible = true;
                m_structures.push_back(s);
                grid.occupy(x, y);
                continue;
            }

            // Rocks: More common in mountains and deserts
            float rockDensity = 0.0f;
            if (biome == Biome::Mountain) {
                rockDensity = m_params.structureDensity * MOUNTAIN_ROCK_DENSITY;
            } else if (biome == Biome::HotDesert || 
                       biome == Biome::TemperateDesert ||
                       biome == Biome::ColdDesert) {
                rockDensity = m_params.structureDensity * DESERT_ROCK_DENSITY;
            } else if (h > BEACH_LEVEL + 50) {
                rockDensity = m_params.structureDensity * HIGHLAND_ROCK_DENSITY;
            }
            
            if (chance < rockDensity) {
                Structure s;
                s.type = StructureType::Rock;
                s.x = x;
                s.y = y;
                s.rotation = 0;
                s.destructible = false;
                m_structures.push_back(s);
                grid.occupy(x, y);
                continue;
            }

            // Bushes: Common in grasslands, savannas, frontiers
            float bushDensity = 0.0f;
            if (biome == Biome::TemperateGrassland || 
                biome == Biome::HotSavanna ||
                biome == Biome::TemperateFrontier ||
                biome == Biome::TropicalFrontier) {
                bushDensity = m_params.structureDensity * GRASSLAND_BUSH_DENSITY;
            }
            
            if (chance < bushDensity) {
                Structure s;
                s.type = StructureType::Bush;
                s.x = x;
                s.y = y;
                s.rotation = 0;
                s.destructible = true;
                m_structures.push_back(s);
                grid.occupy(x, y);
                continue;
            }
        }
    }
}

void WorldGenerator::AnalyzePvPFairness() {
    // TODO
    std::cout << "  PvP fairness analysis" << std::endl;
}

void WorldGenerator::BalanceMap() {
    // Add cover in open areas
    std::mt19937 rng(m_seed + 2000);

    // Scan for open regions and add crates/walls
    for (int y = 50; y < m_worldSize - 50; y += 30) {
        for (int x = 50; x < m_worldSize - 50; x += 30) {
            const float coverDensity = ComputeCoverDensity(x, y, 20);

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
    const int numSpawns = 5;
    for (int i = 0; i < numSpawns; i++) {
        int attempts = 0;
        while (attempts < 100) {
            const int x = rng() % m_worldSize;
            const int y = rng() % m_worldSize;

            const int idx = WorldToTileIndex(x, y);
            const uint8_t h = m_height[idx];
            const Biome biome = static_cast<Biome>(m_biome[idx]);

            // Good spawn: plains, flat, not water
            if (h >= BEACH_LEVEL && h < MOUNTAIN_LEVEL - 30 &&
                !(m_flags[idx] & TileFlags::Water) && 
                biome == Biome::TemperateGrassland &&
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

    const int cx = x / CHUNK_SIZE;
    const int cy = y / CHUNK_SIZE;
    const int tx = x % CHUNK_SIZE;
    const int ty = y % CHUNK_SIZE;

    Chunk* chunk = GetChunk(cx, cy);
    if (!chunk) return nullptr;

    return &chunk->tiles[ty * CHUNK_SIZE + tx];
}

const Tile* WorldGenerator::GetTile(int x, int y) const {
    if (!InBounds(x, y)) return nullptr;

    const int cx = x / CHUNK_SIZE;
    const int cy = y / CHUNK_SIZE;
    const int tx = x % CHUNK_SIZE;
    const int ty = y % CHUNK_SIZE;

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
        const float centerX = r.x + r.w * 0.5f;
        const float centerY = r.y + r.h * 0.5f;
        shape.SetAsBox(r.w * 0.5f, r.h * 0.5f, b2Vec2(centerX, centerY), 0);

        b2FixtureDef fixtureDef;
        fixtureDef.shape = &shape;
        // Use the collision categories from common/enums.hpp
        fixtureDef.filter.categoryBits = static_cast<uint16_t>(CollisionCategory::CAT_WALL);
        fixtureDef.filter.maskBits = static_cast<uint16_t>(CollisionMask::MASK_PLAYER_MOVE) | 
                                     static_cast<uint16_t>(CollisionMask::MASK_BULLET);

        body->CreateFixture(&fixtureDef);
    }

    chunk->physicsBuilt = true;
}

// Inline helper functions

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
        const int nx = x + dx[i];
        const int ny = y + dy[i];

        if (!InBounds(nx, ny)) continue;

        const uint8_t h = m_height[WorldToTileIndex(nx, ny)];
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

    const uint8_t centerHeight = m_height[WorldToTileIndex(x, y)];
    constexpr uint8_t threshold = 10;

    for (int dy = -radius; dy <= radius; dy++) {
        for (int dx = -radius; dx <= radius; dx++) {
            const int nx = x + dx;
            const int ny = y + dy;
            if (!InBounds(nx, ny)) continue;

            const uint8_t h = m_height[WorldToTileIndex(nx, ny)];
            if (std::abs(static_cast<int>(h) - static_cast<int>(centerHeight)) > threshold) {
                return false;
            }
        }
    }

    return true;
}

bool WorldGenerator::NearWater(int x, int y, int radius) const {
    for (int dy = -radius; dy <= radius; dy++) {
        for (int dx = -radius; dx <= radius; dx++) {
            const int nx = x + dx;
            const int ny = y + dy;
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
    const uint8_t h = m_height[WorldToTileIndex(x, y)];
    if (h > MOUNTAIN_LEVEL - 20) {
        flags |= TileFlags::Solid;
    }

    return flags;
}

float WorldGenerator::ComputeSightlineLength(int x, int y, float angle) const {
    // TODO: Implement proper raycasting
    // This is a placeholder for future LOS analysis
    return 0.0f;
}

float WorldGenerator::ComputeCoverDensity(int x, int y, int radius) const {
    int total = 0;
    int coverCount = 0;

    for (int dy = -radius; dy <= radius; dy++) {
        for (int dx = -radius; dx <= radius; dx++) {
            const int nx = x + dx;
            const int ny = y + dy;
            if (!InBounds(nx, ny)) continue;

            total++;
            const uint8_t flags = m_flags[WorldToTileIndex(nx, ny)];
            if (flags & (TileFlags::Solid | TileFlags::Cover)) {
                coverCount++;
            }
        }
    }

    return total > 0 ? static_cast<float>(coverCount) / total : 0.0f;
}