#pragma once
#include <vector>
#include <string>
#include <cstdint>
#include "external/FastNoiseLite.h"
#include "external/stb_image_write.h"

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

struct BiomeRegion {
    BiomeType type;
    std::vector<std::pair<int, int>> points;
    float avgHeight;
};

class VolcanicWorld {
public:
    VolcanicWorld();
    
    void generateIsland(int width, int height, const std::string& outputDir);
    void generateBiomePolygons(const std::string& outputFile);
    void renderBiomeRegions(const std::string& outputFile);
    
    void setIslandSize(float size) { 
        islandSize = std::max(0.1f, std::min(size, 1.5f)); 
    }
    
    void setNoiseLayers(int layers) {
        numNoiseLayers = std::max(1, std::min(layers, 5));
    }
    
    void setMasterSeed(int seed) {
        masterSeed = seed;
    }

private:
    int width;
    int height;
    float islandSize;
    int numNoiseLayers;
    int masterSeed;
    
    std::vector<float> radialGradient;
    std::vector<float> organicNoise;
    std::vector<float> heightmap;
    
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
    const char* getBiomeName(BiomeType type);
    void classifyBiomes(std::vector<BiomeType>& biomeMap);
    void extractBiomeRegions(const std::vector<BiomeType>& biomeMap, std::vector<BiomeRegion>& regions);
    void saveBiomePolygonsJSON(const std::vector<BiomeRegion>& regions, const std::string& filename);
    Color getBiomeColor(BiomeType type);
    void renderRegionsToImage(const std::vector<BiomeRegion>& regions, const std::string& filename);
};