#include "VolcanicWorld.hpp"
#include <cmath>
#include <algorithm>
#include <iostream>
#include <fstream>
#include <filesystem>

namespace fs = std::filesystem;

VolcanicWorld::VolcanicWorld()
    : width(0), height(0), islandSize(1.0f), numNoiseLayers(3), masterSeed(42) {
}

void VolcanicWorld::createOutputDirectory() {
    if (!outputDirectory.empty()) {
        fs::create_directories(outputDirectory);
    }
}

uint8_t VolcanicWorld::floatToUint8(float v) {
    v = std::clamp(v, 0.0f, 1.0f);
    return static_cast<uint8_t>(v * 255.0f);
}

void VolcanicWorld::saveFloatImageAsGrayscale(
    const std::string& filename,
    const std::vector<float>& data
) {
    std::vector<uint8_t> img(data.size());
    for (size_t i = 0; i < data.size(); ++i) {
        img[i] = floatToUint8(data[i]);
    }

    stbi_write_png(
        filename.c_str(),
        width,
        height,
        1,
        img.data(),
        width
    );
}

/* ============================================================
   COLOR UTILITIES
   ============================================================ */
Color VolcanicWorld::lerpColor(const Color& a, const Color& b, float t) {
    t = std::clamp(t, 0.0f, 1.0f);
    return Color(
        static_cast<uint8_t>(a.r + (b.r - a.r) * t),
        static_cast<uint8_t>(a.g + (b.g - a.g) * t),
        static_cast<uint8_t>(a.b + (b.b - a.b) * t)
    );
}

Color VolcanicWorld::getTerrainColor(float height) {
    // Colors sampled from aerial photos of volcanic islands
    // Deep water -> Shallow water -> Beach -> Grass -> Mountain -> Peak
    
    if (height < 0.30f) {
        // Deep water (dark blue)
        Color deepWater(8, 24, 58);
        Color mediumWater(15, 40, 90);
        float t = height / 0.30f;
        return lerpColor(deepWater, mediumWater, t);
    }
    else if (height < 0.38f) {
        // Medium to shallow water
        Color mediumWater(15, 40, 90);
        Color shallowWater(40, 85, 150);
        float t = (height - 0.30f) / 0.08f;
        return lerpColor(mediumWater, shallowWater, t);
    }
    else if (height < 0.42f) {
        // Shallow water to beach
        Color shallowWater(40, 85, 150);
        Color beach(210, 190, 140);
        float t = (height - 0.38f) / 0.04f;
        return lerpColor(shallowWater, beach, t);
    }
    else if (height < 0.50f) {
        // Beach to coastal grass
        Color beach(210, 190, 140);
        Color coastalGrass(140, 160, 90);
        float t = (height - 0.42f) / 0.08f;
        return lerpColor(beach, coastalGrass, t);
    }
    else if (height < 0.65f) {
        // Coastal grass to inland vegetation
        Color coastalGrass(140, 160, 90);
        Color vegetation(80, 120, 60);
        float t = (height - 0.50f) / 0.15f;
        return lerpColor(coastalGrass, vegetation, t);
    }
    else if (height < 0.80f) {
        // Vegetation to volcanic rock
        Color vegetation(80, 120, 60);
        Color volcanicRock(70, 60, 55);
        float t = (height - 0.65f) / 0.15f;
        return lerpColor(vegetation, volcanicRock, t);
    }
    else {
        // Volcanic rock to peak
        Color volcanicRock(70, 60, 55);
        Color peak(90, 80, 75);
        float t = (height - 0.80f) / 0.20f;
        return lerpColor(volcanicRock, peak, t);
    }
}

void VolcanicWorld::saveColoredImage(
    const std::string& filename,
    const std::vector<float>& heightData
) {
    std::vector<uint8_t> colorImage(width * height * 3);
    
    for (int i = 0; i < width * height; ++i) {
        Color c = getTerrainColor(heightData[i]);
        colorImage[i * 3 + 0] = c.r;
        colorImage[i * 3 + 1] = c.g;
        colorImage[i * 3 + 2] = c.b;
    }
    
    stbi_write_png(
        filename.c_str(),
        width,
        height,
        3,
        colorImage.data(),
        width * 3
    );
}

/* ============================================================
   PSEUDORANDOM SEED GENERATOR
   ============================================================ */
int VolcanicWorld::generateSeed(int index) {
    // Simple Linear Congruential Generator (LCG)
    // Using constants from Numerical Recipes
    long long x = masterSeed + index;
    x = (x * 1664525LL + 1013904223LL) & 0x7FFFFFFF;
    return static_cast<int>(x);
}

/* ============================================================
   STEP 1: RADIAL GRADIENT (CONE SHAPE)
   ============================================================ */
void VolcanicWorld::generateRadialGradient() {
    radialGradient.assign(width * height, 0.0f);
    
    float cx = width * 0.5f;
    float cy = height * 0.5f;
    float maxDist = std::sqrt(cx * cx + cy * cy);
    
    // Apply island size scaling
    maxDist /= islandSize;
    
    for (int y = 0; y < height; ++y) {
        for (int x = 0; x < width; ++x) {
            float dx = x - cx;
            float dy = y - cy;
            float d = std::sqrt(dx * dx + dy * dy) / maxDist;
            
            // Create cone that's white in center, black at edges
            float value = 1.0f - d;
            value = std::clamp(value, 0.0f, 1.0f);
            
            radialGradient[y * width + x] = value;
        }
    }
    
    saveFloatImageAsGrayscale(
        outputDirectory + "/step1_radial_gradient.png",
        radialGradient
    );
    
    std::cout << "Step 1: Radial gradient created (island size: " << islandSize << ")\n";
}

/* ============================================================
   STEP 2: ORGANIC NOISE (MULTIPLE LAYERS)
   ============================================================ */
void VolcanicWorld::generateOrganicNoise() {
    organicNoise.assign(width * height, 0.0f);
    
    std::vector<std::vector<float>> noiseLayers_data;
    
    // Generate multiple noise layers with different characteristics
    for (int layer = 0; layer < numNoiseLayers; ++layer) {
        std::vector<float> layerData(width * height);
        
        // Create a new noise generator for each layer
        FastNoiseLite layerNoiseGen;
        
        // Generate unique seed from master seed
        int layerSeed = generateSeed(layer);
        layerNoiseGen.SetSeed(layerSeed);
        
        // Each layer has different frequency for varied detail
        float frequency = 0.008f * (1.0f + layer * 0.3f);
        
        layerNoiseGen.SetNoiseType(FastNoiseLite::NoiseType_OpenSimplex2);
        layerNoiseGen.SetFractalType(FastNoiseLite::FractalType_FBm);
        layerNoiseGen.SetFractalOctaves(3);
        layerNoiseGen.SetFractalLacunarity(2.0f);
        layerNoiseGen.SetFractalGain(0.5f);
        layerNoiseGen.SetFrequency(frequency);
        
        for (int y = 0; y < height; ++y) {
            for (int x = 0; x < width; ++x) {
                float n = layerNoiseGen.GetNoise((float)x, (float)y);
                layerData[y * width + x] = (n + 1.0f) * 0.5f;
            }
        }
        
        noiseLayers_data.push_back(layerData);
        
        // Save individual layer for debugging
        saveFloatImageAsGrayscale(
            outputDirectory + "/step2_noise_layer" + std::to_string(layer + 1) + ".png",
            layerData
        );
    }
    
    // Average all noise layers together
    for (int i = 0; i < width * height; ++i) {
        float sum = 0.0f;
        for (int layer = 0; layer < numNoiseLayers; ++layer) {
            sum += noiseLayers_data[layer][i];
        }
        organicNoise[i] = sum / static_cast<float>(numNoiseLayers);
    }
    
    saveFloatImageAsGrayscale(
        outputDirectory + "/step2_organic_noise_combined.png",
        organicNoise
    );
    
    std::cout << "Step 2: Generated and averaged " << numNoiseLayers << " noise layers (master seed: " << masterSeed << ")\n";
}

/* ============================================================
   STEP 3: AVERAGE THEM TOGETHER
   ============================================================ */
void VolcanicWorld::averageTogether() {
    heightmap.assign(width * height, 0.0f);
    
    for (int i = 0; i < width * height; ++i) {
        // Average the radial gradient and organic noise
        heightmap[i] = (radialGradient[i] + organicNoise[i]) * 0.5f;
    }
    
    saveFloatImageAsGrayscale(
        outputDirectory + "/step3_averaged.png",
        heightmap
    );
    
    std::cout << "Step 3: Averaged gradient and noise together\n";
}

/* ============================================================
   NORMALIZE (OPTIONAL - ENSURE 0-1 RANGE)
   ============================================================ */
void VolcanicWorld::normalizeHeightmap() {
    float minH = 1.0f;
    float maxH = 0.0f;
    
    for (float v : heightmap) {
        minH = std::min(minH, v);
        maxH = std::max(maxH, v);
    }
    
    float range = maxH - minH;
    if (range > 0.0f) {
        for (float& v : heightmap) {
            v = (v - minH) / range;
        }
    }
}

/* ============================================================
   MAIN PIPELINE
   ============================================================ */
void VolcanicWorld::generateIsland(
    int w,
    int h,
    const std::string& outputDir
) {
    width = w;
    height = h;
    outputDirectory = outputDir;
    
    createOutputDirectory();
    
    // Follow the volcanic island generation guide
    generateRadialGradient();     // Step 1: Cone shape
    generateOrganicNoise();        // Step 2: Bumpy organic pattern
    averageTogether();             // Step 3: Combine them
    normalizeHeightmap();          // Ensure proper range
    
    // Step 4: Colorize
    saveColoredImage(
        outputDirectory + "/step4_colored_island.png",
        heightmap
    );
    
    std::cout << "Step 4: Colored island created\n";
    std::cout << "\nVolcanic island generation complete!\n";
}

/* ============================================================
   BIOME CLASSIFICATION
   ============================================================ */
BiomeType VolcanicWorld::getBiomeType(float height) {
    if (height < 0.30f) return BIOME_DEEP_WATER;
    else if (height < 0.38f) return BIOME_SHALLOW_WATER;
    else if (height < 0.42f) return BIOME_BEACH;
    else if (height < 0.50f) return BIOME_GRASSLAND;
    else if (height < 0.70f) return BIOME_FOREST;
    else if (height < 0.85f) return BIOME_MOUNTAIN;
    else return BIOME_PEAK;
}

const char* VolcanicWorld::getBiomeName(BiomeType type) {
    switch(type) {
        case BIOME_DEEP_WATER: return "Deep Water";
        case BIOME_SHALLOW_WATER: return "Shallow Water";
        case BIOME_BEACH: return "Beach";
        case BIOME_GRASSLAND: return "Grassland";
        case BIOME_FOREST: return "Forest";
        case BIOME_MOUNTAIN: return "Mountain";
        case BIOME_PEAK: return "Peak";
        default: return "Unknown";
    }
}

void VolcanicWorld::classifyBiomes(std::vector<BiomeType>& biomeMap) {
    biomeMap.resize(width * height);
    
    for (int i = 0; i < width * height; ++i) {
        biomeMap[i] = getBiomeType(heightmap[i]);
    }
}

/* ============================================================
   BIOME REGION EXTRACTION
   ============================================================ */
void VolcanicWorld::extractBiomeRegions(
    const std::vector<BiomeType>& biomeMap,
    std::vector<BiomeRegion>& regions
) {
    regions.clear();
    std::vector<bool> visited(width * height, false);
    
    // Flood fill to find connected regions
    for (int y = 0; y < height; ++y) {
        for (int x = 0; x < width; ++x) {
            int idx = y * width + x;
            
            if (visited[idx]) continue;
            
            BiomeType type = biomeMap[idx];
            BiomeRegion region;
            region.type = type;
            region.avgHeight = 0.0f;
            
            // Simple flood fill using a queue
            std::vector<std::pair<int, int>> queue;
            queue.push_back({x, y});
            visited[idx] = true;
            
            while (!queue.empty()) {
                auto [cx, cy] = queue.back();
                queue.pop_back();
                
                int cidx = cy * width + cx;
                region.points.push_back({cx, cy});
                region.avgHeight += heightmap[cidx];
                
                // Check 4-connected neighbors
                int dx[] = {-1, 1, 0, 0};
                int dy[] = {0, 0, -1, 1};
                
                for (int i = 0; i < 4; ++i) {
                    int nx = cx + dx[i];
                    int ny = cy + dy[i];
                    
                    if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                        int nidx = ny * width + nx;
                        if (!visited[nidx] && biomeMap[nidx] == type) {
                            visited[nidx] = true;
                            queue.push_back({nx, ny});
                        }
                    }
                }
            }
            
            if (!region.points.empty()) {
                region.avgHeight /= region.points.size();
                regions.push_back(region);
            }
        }
    }
    
    std::cout << "Extracted " << regions.size() << " biome regions\n";
}

/* ============================================================
   SAVE BIOME POLYGONS TO JSON
   ============================================================ */
void VolcanicWorld::saveBiomePolygonsJSON(
    const std::vector<BiomeRegion>& regions,
    const std::string& filename
) {
    std::ofstream out(filename);
    if (!out.is_open()) {
        std::cerr << "Failed to open " << filename << " for writing\n";
        return;
    }
    
    out << "{\n";
    out << "  \"width\": " << width << ",\n";
    out << "  \"height\": " << height << ",\n";
    out << "  \"regions\": [\n";
    
    for (size_t i = 0; i < regions.size(); ++i) {
        const auto& region = regions[i];
        
        // Only export regions with reasonable size (filter out tiny regions)
        if (region.points.size() < 10) continue;
        
        out << "    {\n";
        out << "      \"biome\": \"" << getBiomeName(region.type) << "\",\n";
        out << "      \"biomeId\": " << static_cast<int>(region.type) << ",\n";
        out << "      \"avgHeight\": " << region.avgHeight << ",\n";
        out << "      \"pixelCount\": " << region.points.size() << ",\n";
        out << "      \"boundingBox\": {\n";
        
        // Calculate bounding box
        int minX = width, maxX = 0, minY = height, maxY = 0;
        for (const auto& [px, py] : region.points) {
            minX = std::min(minX, px);
            maxX = std::max(maxX, px);
            minY = std::min(minY, py);
            maxY = std::max(maxY, py);
        }
        
        out << "        \"minX\": " << minX << ",\n";
        out << "        \"minY\": " << minY << ",\n";
        out << "        \"maxX\": " << maxX << ",\n";
        out << "        \"maxY\": " << maxY << "\n";
        out << "      }\n";
        out << "    }";
        
        if (i < regions.size() - 1) out << ",";
        out << "\n";
    }
    
    out << "  ]\n";
    out << "}\n";
    
    out.close();
    std::cout << "Saved biome polygons to " << filename << "\n";
}

/* ============================================================
   GENERATE BIOME POLYGONS (PUBLIC API)
   ============================================================ */
void VolcanicWorld::generateBiomePolygons(const std::string& outputFile) {
    if (heightmap.empty()) {
        std::cerr << "Error: No heightmap data. Run generateIsland() first.\n";
        return;
    }
    
    std::cout << "\nGenerating biome polygons...\n";
    
    // Step 1: Classify each pixel into a biome
    std::vector<BiomeType> biomeMap;
    classifyBiomes(biomeMap);
    
    // Step 2: Extract connected regions
    std::vector<BiomeRegion> regions;
    extractBiomeRegions(biomeMap, regions);
    
    // Step 3: Save to JSON
    saveBiomePolygonsJSON(regions, outputFile);
    
    std::cout << "Biome polygon generation complete!\n";
}

/* ============================================================
   GET BIOME COLOR (FLAT COLORS FOR REGIONS)
   ============================================================ */
Color VolcanicWorld::getBiomeColor(BiomeType type) {
    switch(type) {
        case BIOME_DEEP_WATER:
            return Color(20, 40, 100);      // Dark blue
        case BIOME_SHALLOW_WATER:
            return Color(60, 110, 180);     // Light blue
        case BIOME_BEACH:
            return Color(220, 200, 150);    // Sandy
        case BIOME_GRASSLAND:
            return Color(120, 180, 80);     // Light green
        case BIOME_FOREST:
            return Color(60, 120, 50);      // Dark green
        case BIOME_MOUNTAIN:
            return Color(100, 90, 80);      // Gray-brown
        case BIOME_PEAK:
            return Color(140, 130, 120);    // Light gray
        default:
            return Color(255, 0, 255);      // Magenta for unknown
    }
}

/* ============================================================
   RENDER REGIONS TO IMAGE
   ============================================================ */
void VolcanicWorld::renderRegionsToImage(
    const std::vector<BiomeRegion>& regions,
    const std::string& filename
) {
    // Create a blank image
    std::vector<uint8_t> image(width * height * 3, 0);
    
    // Fill each region with its biome color
    for (const auto& region : regions) {
        Color c = getBiomeColor(region.type);
        
        for (const auto& [x, y] : region.points) {
            int idx = (y * width + x) * 3;
            image[idx + 0] = c.r;
            image[idx + 1] = c.g;
            image[idx + 2] = c.b;
        }
    }
    
    stbi_write_png(
        filename.c_str(),
        width,
        height,
        3,
        image.data(),
        width * 3
    );
    
    std::cout << "Rendered biome regions to " << filename << "\n";
}

/* ============================================================
   RENDER BIOME REGIONS (PUBLIC API)
   ============================================================ */
void VolcanicWorld::renderBiomeRegions(const std::string& outputFile) {
    if (heightmap.empty()) {
        std::cerr << "Error: No heightmap data. Run generateIsland() first.\n";
        return;
    }
    
    std::cout << "\nRendering biome regions...\n";
    
    // Step 1: Classify each pixel into a biome
    std::vector<BiomeType> biomeMap;
    classifyBiomes(biomeMap);
    
    // Step 2: Extract connected regions
    std::vector<BiomeRegion> regions;
    extractBiomeRegions(biomeMap, regions);
    
    // Step 3: Render to image
    renderRegionsToImage(regions, outputFile);
    
    std::cout << "Biome region rendering complete!\n";
}