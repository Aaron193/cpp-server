#pragma once
#include <vector>
#include <string>
#include <cstdint>
#include <deque>
#include "external/FastNoiseLite.h"

// Forward declarations for Box2D
class b2World;
class b2Body;

struct Color {
    uint8_t r, g, b;
    
    Color() : r(0), g(0), b(0) {}
    Color(uint8_t red, uint8_t green, uint8_t blue) 
        : r(red), g(green), b(blue) {}
};

enum BiomeType {
    BIOME_DEEP_WATER = 0,
    BIOME_SHALLOW_WATER = 1,
    BIOME_BEACH = 2,
    BIOME_GRASSLAND = 3,
    BIOME_FOREST = 4,
    BIOME_MOUNTAIN = 5,
    BIOME_PEAK = 6
};

struct Vec2 {
    float x, y;
    
    Vec2() : x(0.0f), y(0.0f) {}
    Vec2(float _x, float _y) : x(_x), y(_y) {}
};

struct TerrainMesh {
    BiomeType biome;
    std::vector<Vec2> vertices;
    std::vector<uint32_t> indices; // triangles (triples)
};



class World {
public:
    World();
    
    void generateIsland(int width, int height, const std::string& outputDir);
    
    // New mesh-based terrain generation
    std::vector<TerrainMesh> buildTerrainMeshes();
    void saveTerrainMeshesJSON(const std::vector<TerrainMesh>& meshes, const std::string& filename);

    // Box2D physics integration
    void BuildMeshPhysics(const std::vector<TerrainMesh>& meshes, b2World& physicsWorld);

    // Game integration
    uint32_t GetSeed() const { return m_seed; }
    int GetWorldSize() const { return width; }
    
    // Save final terrain visualization
    void saveFinalTerrainImage(const std::string& filename);
    
    // Query biome at world position
    BiomeType GetBiomeAtPosition(float worldX, float worldY) const;
    
    // Get biome name for display
    const char* GetBiomeName(BiomeType type) const;

    void setIslandSize(float size) {
        islandSize = std::max(0.1f, std::min(size, 1.5f)); 
    }
    
    void setNoiseLayers(int layers) {
        numNoiseLayers = std::max(1, std::min(layers, 5));
    }
    
    void setMasterSeed(int seed) {
        masterSeed = seed;
        m_seed = seed;
    }

private:
    int width;
    int height;
    float islandSize;
    int numNoiseLayers;
    int masterSeed;
    uint32_t m_seed;
    
    std::vector<float> radialGradient;
    std::vector<float> organicNoise;
    std::vector<float> heightmap;
    std::vector<BiomeType> biomeMap;  // Cached biome classification
    
    std::string outputDirectory;

    void createOutputDirectory();
    uint8_t floatToUint8(float value);
    void saveFloatImageAsGrayscale(const std::string& filename, const std::vector<float>& data);
    void saveColoredImage(const std::string& filename, const std::vector<float>& heightData);
    
    void generateRadialGradient();
    void generateOrganicNoise();
    void averageTogether();
    void normalizeHeightmap();
    
    Color getTerrainColor(float height);
    Color lerpColor(const Color& a, const Color& b, float t);
    int generateSeed(int index);
    
    BiomeType getBiomeType(float height);
    const char* getBiomeName(BiomeType type) const;
    void classifyBiomes(std::vector<BiomeType>& biomeMap);
    Color getBiomeColor(BiomeType type);
};