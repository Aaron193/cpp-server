#include "VolcanicWorld.hpp"
#include <cmath>
#include <algorithm>
#include <iostream>
#include <fstream>
#include <filesystem>
#include <unordered_set>
#include <array>
#include "external/earcut.hpp"

namespace fs = std::filesystem;

VolcanicWorld::VolcanicWorld()
    : width(0), height(0), islandSize(1.0f), numNoiseLayers(3), masterSeed(42) {
}

void VolcanicWorld::createOutputDirectory() {
    if (!outputDirectory.empty()) {
        try {
            fs::create_directories(outputDirectory);
        } catch (const fs::filesystem_error& e) {
            std::cerr << "Failed to create output directory: " << e.what() << "\n";
        }
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
        static_cast<uint8_t>(std::round(a.r + (b.r - a.r) * t)),
        static_cast<uint8_t>(std::round(a.g + (b.g - a.g) * t)),
        static_cast<uint8_t>(std::round(a.b + (b.b - a.b) * t))
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
    x = (x * 1664525LL + 1013904223LL);
    // Ensure positive seed by masking to positive int range
    return static_cast<int>(x & 0x7FFFFFFF);
}

/* ============================================================
   STEP 1: RADIAL GRADIENT (CONE SHAPE)
   ============================================================ */
void VolcanicWorld::generateRadialGradient() {
    radialGradient.assign(width * height, 0.0f);
    
    float cx = width * 0.5f;
    float cy = height * 0.5f;
    float maxDist = std::sqrt(cx * cx + cy * cy);
    
    // Apply island size scaling - larger values = larger island
    maxDist *= islandSize;
    
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
        
        // Each layer has different frequency and octaves for varied detail
        float frequency = 0.008f * (1.0f + layer * 0.4f);
        int octaves = 3 + (layer % 2); // Vary octaves between 3 and 4
        
        layerNoiseGen.SetNoiseType(FastNoiseLite::NoiseType_OpenSimplex2);
        layerNoiseGen.SetFractalType(FastNoiseLite::FractalType_FBm);
        layerNoiseGen.SetFractalOctaves(octaves);
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
    
    // Weighted average - first layers have more influence
    float totalWeight = 0.0f;
    for (int layer = 0; layer < numNoiseLayers; ++layer) {
        totalWeight += 1.0f / (layer + 1);
    }
    
    for (int i = 0; i < width * height; ++i) {
        float weightedSum = 0.0f;
        for (int layer = 0; layer < numNoiseLayers; ++layer) {
            float weight = 1.0f / (layer + 1);
            weightedSum += noiseLayers_data[layer][i] * weight;
        }
        organicNoise[i] = weightedSum / totalWeight;
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
        // Weight gradient more heavily to maintain island shape
        heightmap[i] = radialGradient[i] * 0.65f + organicNoise[i] * 0.35f;
    }
    
    saveFloatImageAsGrayscale(
        outputDirectory + "/step3_averaged.png",
        heightmap
    );
    
    std::cout << "Step 3: Averaged gradient and noise together (65% gradient, 35% noise)\n";
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
   GET BIOME COLOR (FLAT COLORS FOR BIOMES)
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
   POLYGON CLEANUP UTILITIES
   ============================================================ */

static float signedArea(const std::vector<Vec2>& v) {
    float a = 0.0f;
    for (size_t i = 0; i < v.size(); ++i) {
        const auto& p = v[i];
        const auto& q = v[(i + 1) % v.size()];
        a += (p.x * q.y - q.x * p.y);
    }
    return 0.5f * a;
}

static void enforceCCW(std::vector<Vec2>& v) {
    if (signedArea(v) < 0.0f)
        std::reverse(v.begin(), v.end());
}

static bool collinear(const Vec2& a, const Vec2& b, const Vec2& c) {
    float cross = (b.x - a.x) * (c.y - b.y) -
                  (b.y - a.y) * (c.x - b.x);
    return std::abs(cross) < 1e-4f;
}

static void removeCollinear(std::vector<Vec2>& v) {
    if (v.size() < 3) return;
    std::vector<Vec2> out;
    for (size_t i = 0; i < v.size(); ++i) {
        const Vec2& prev = v[(i + v.size() - 1) % v.size()];
        const Vec2& cur  = v[i];
        const Vec2& next = v[(i + 1) % v.size()];
        if (!collinear(prev, cur, next))
            out.push_back(cur);
    }
    v.swap(out);
}

/* ============================================================
   MARCHING SQUARES CONTOUR EXTRACTION
   ============================================================ */

static std::vector<std::vector<Vec2>> marchingSquares(
    const std::vector<BiomeType>& biomeMap,
    int width, int height,
    BiomeType biome
) {
    std::vector<std::vector<Vec2>> contours;

    auto inside = [&](int x, int y) {
        if (x < 0 || y < 0 || x >= width || y >= height) return false;
        return biomeMap[y * width + x] == biome;
    };

    // Track which cells have been processed
    std::vector<std::vector<bool>> used(height, std::vector<bool>(width, false));

    // Process each cell
    for (int y = 0; y < height - 1; ++y) {
        for (int x = 0; x < width - 1; ++x) {
            // Calculate marching squares case (4-bit mask)
            int mask = 0;
            if (inside(x, y)) mask |= 1;
            if (inside(x + 1, y)) mask |= 2;
            if (inside(x + 1, y + 1)) mask |= 4;
            if (inside(x, y + 1)) mask |= 8;

            // Skip empty or full cells
            if (mask == 0 || mask == 15) continue;

            // Build edge segments for this cell
            std::vector<Vec2> poly;
            float fx = (float)x;
            float fy = (float)y;

            auto mid = [&](float ax, float ay, float bx, float by) {
                return Vec2((ax + bx) * 0.5f, (ay + by) * 0.5f);
            };

            // Handle different marching squares cases
            // Generate edge segments based on the case
            switch (mask) {
                case 1:
                case 14:
                    poly.push_back(mid(fx, fy, fx + 1, fy));
                    poly.push_back(mid(fx, fy, fx, fy + 1));
                    break;
                case 2:
                case 13:
                    poly.push_back(mid(fx + 1, fy, fx + 1, fy + 1));
                    poly.push_back(mid(fx, fy, fx + 1, fy));
                    break;
                case 4:
                case 11:
                    poly.push_back(mid(fx, fy + 1, fx + 1, fy + 1));
                    poly.push_back(mid(fx + 1, fy, fx + 1, fy + 1));
                    break;
                case 7:
                case 8:
                    poly.push_back(mid(fx, fy, fx, fy + 1));
                    poly.push_back(mid(fx, fy + 1, fx + 1, fy + 1));
                    break;
                case 3:
                case 12:
                    poly.push_back(mid(fx, fy, fx + 1, fy));
                    poly.push_back(mid(fx, fy + 1, fx + 1, fy + 1));
                    break;
                case 5:
                    // Saddle point - ambiguous case
                    poly.push_back(mid(fx, fy, fx + 1, fy));
                    poly.push_back(mid(fx, fy, fx, fy + 1));
                    break;
                case 10:
                    // Saddle point - ambiguous case  
                    poly.push_back(mid(fx + 1, fy, fx + 1, fy + 1));
                    poly.push_back(mid(fx, fy + 1, fx + 1, fy + 1));
                    break;
                case 6:
                case 9:
                    poly.push_back(mid(fx + 1, fy, fx + 1, fy + 1));
                    poly.push_back(mid(fx, fy, fx, fy + 1));
                    break;
                default:
                    continue;
            }

            if (poly.size() >= 2)
                contours.push_back(poly);
        }
    }

    // Merge edge segments into closed contours
    // For now, we return individual segments - a more sophisticated
    // implementation would chain them into complete loops
    // This simplified version generates small edge segments
    
    return contours;
}

// Better marching squares implementation that builds complete closed contours
static std::vector<Vec2> extractContour(
    const std::vector<BiomeType>& biomeMap,
    int width, int height,
    BiomeType biome
) {
    // Find boundary pixels using simple edge detection
    std::vector<Vec2> contour;
    
    auto inside = [&](int x, int y) {
        if (x < 0 || y < 0 || x >= width || y >= height) return false;
        return biomeMap[y * width + x] == biome;
    };
    
    // Find all boundary pixels
    std::vector<std::pair<int, int>> boundary;
    for (int y = 0; y < height; ++y) {
        for (int x = 0; x < width; ++x) {
            if (!inside(x, y)) continue;
            
            // Check if this is a boundary pixel (has at least one non-biome neighbor)
            bool isBoundary = false;
            for (int dy = -1; dy <= 1; ++dy) {
                for (int dx = -1; dx <= 1; ++dx) {
                    if (dx == 0 && dy == 0) continue;
                    if (!inside(x + dx, y + dy)) {
                        isBoundary = true;
                        break;
                    }
                }
                if (isBoundary) break;
            }
            
            if (isBoundary) {
                boundary.push_back({x, y});
            }
        }
    }
    
    if (boundary.empty()) return contour;
    
    // Find convex hull or use boundary pixels as-is
    // For simplicity, we'll sample boundary pixels uniformly
    int step = std::max(1, (int)boundary.size() / 200); // Limit to ~200 vertices
    for (size_t i = 0; i < boundary.size(); i += step) {
        contour.push_back(Vec2((float)boundary[i].first, (float)boundary[i].second));
    }
    
    return contour;
}

/* ============================================================
   BUILD TERRAIN MESHES (MAIN PIPELINE)
   ============================================================ */

std::vector<TerrainMesh> VolcanicWorld::buildTerrainMeshes() {
    std::vector<TerrainMesh> meshes;

    if (heightmap.empty()) {
        std::cerr << "Error: No heightmap data. Run generateIsland() first.\n";
        return meshes;
    }

    std::cout << "\nBuilding terrain meshes using marching squares + triangulation...\n";

    // Step 1: Classify biomes
    std::vector<BiomeType> biomeMap;
    classifyBiomes(biomeMap);

    // Step 2: For each biome type, extract contours and triangulate
    for (int b = BIOME_DEEP_WATER; b <= BIOME_PEAK; ++b) {
        BiomeType biome = static_cast<BiomeType>(b);

        // Extract contour for this biome
        auto contour = extractContour(biomeMap, width, height, biome);

        if (contour.size() < 3) {
            std::cout << "  Skipping " << getBiomeName(biome) << " (insufficient vertices)\n";
            continue;
        }

        // Clean up the polygon
        removeCollinear(contour);
        enforceCCW(contour);

        if (contour.size() < 3) {
            std::cout << "  Skipping " << getBiomeName(biome) << " (too few vertices after cleanup)\n";
            continue;
        }

        // Prepare for earcut triangulation
        // earcut expects vector<vector<vector<N>>> where:
        // - Outer vector: polygons
        // - Middle vector: rings (first is outer, rest are holes)
        // - Inner vector: coordinates [x, y, x, y, ...]
        
        using Coord = float;
        using N = uint32_t;
        std::vector<std::vector<std::array<Coord, 2>>> polygon;
        
        // Outer ring
        std::vector<std::array<Coord, 2>> ring;
        for (const auto& v : contour) {
            ring.push_back({v.x, v.y});
        }
        polygon.push_back(ring);

        // Triangulate
        std::vector<N> indices = mapbox::earcut<N>(polygon);

        if (indices.empty() || indices.size() % 3 != 0) {
            std::cout << "  Skipping " << getBiomeName(biome) << " (triangulation failed)\n";
            continue;
        }

        // Create mesh
        TerrainMesh mesh;
        mesh.biome = biome;
        mesh.vertices = contour;
        mesh.indices = indices;

        meshes.push_back(mesh);

        std::cout << "  " << getBiomeName(biome) << ": "
                  << contour.size() << " vertices, "
                  << (indices.size() / 3) << " triangles\n";
    }

    std::cout << "Generated " << meshes.size() << " terrain meshes\n";
    return meshes;
}

/* ============================================================
   SAVE TERRAIN MESHES TO JSON
   ============================================================ */

void VolcanicWorld::saveTerrainMeshesJSON(
    const std::vector<TerrainMesh>& meshes,
    const std::string& filename
) {
    std::ofstream out(filename);
    if (!out.is_open()) {
        std::cerr << "Failed to open " << filename << " for writing\n";
        return;
    }

    out << "{\n";
    out << "  \"worldSize\": [" << width << ", " << height << "],\n";
    out << "  \"meshes\": [\n";

    for (size_t i = 0; i < meshes.size(); ++i) {
        const auto& m = meshes[i];
        
        if (i > 0) out << ",\n";
        
        out << "    {\n";
        out << "      \"biome\": " << (int)m.biome << ",\n";
        out << "      \"biomeName\": \"" << getBiomeName(m.biome) << "\",\n";
        out << "      \"vertices\": [";

        for (size_t v = 0; v < m.vertices.size(); ++v) {
            if (v > 0) out << ", ";
            out << "[" << m.vertices[v].x << ", " << m.vertices[v].y << "]";
        }

        out << "],\n";
        out << "      \"indices\": [";

        for (size_t k = 0; k < m.indices.size(); ++k) {
            if (k > 0) out << ", ";
            out << m.indices[k];
        }

        out << "]\n";
        out << "    }";
    }

    out << "\n  ]\n";
    out << "}\n";

    out.close();
    std::cout << "Saved terrain meshes to " << filename << "\n";
}