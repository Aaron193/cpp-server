#include "World.hpp"

#include <box2d/box2d.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <iostream>

#include "external/FastNoiseLite.h"
#include "external/earcut.hpp"
#include "physics/PhysicsWorld.hpp"
#include "util/units.hpp"

#define STB_IMAGE_WRITE_IMPLEMENTATION
#include "external/stb_image_write.h"

namespace fs = std::filesystem;

World::World()
    : width(0),
      height(0),
      islandSize(1.0f),
      numNoiseLayers(3),
      masterSeed(42),
      m_seed(42) {}

void World::createOutputDirectory() {
    if (!outputDirectory.empty()) {
        try {
            fs::create_directories(outputDirectory);
        } catch (const fs::filesystem_error& e) {
            std::cerr << "Failed to create output directory: " << e.what()
                      << "\n";
        }
    }
}

uint8_t World::floatToUint8(float v) {
    v = std::clamp(v, 0.0f, 1.0f);
    return static_cast<uint8_t>(v * 255.0f);
}

void World::saveFloatImageAsGrayscale(const std::string& filename,
                                      const std::vector<float>& data) {
    std::vector<uint8_t> img(data.size());
    for (size_t i = 0; i < data.size(); ++i) {
        img[i] = floatToUint8(data[i]);
    }

    stbi_write_png(filename.c_str(), width, height, 1, img.data(), width);
}

/* ============================================================
   COLOR UTILITIES
   ============================================================ */
Color World::lerpColor(const Color& a, const Color& b, float t) {
    t = std::clamp(t, 0.0f, 1.0f);
    return Color(static_cast<uint8_t>(std::round(a.r + (b.r - a.r) * t)),
                 static_cast<uint8_t>(std::round(a.g + (b.g - a.g) * t)),
                 static_cast<uint8_t>(std::round(a.b + (b.b - a.b) * t)));
}

Color World::getTerrainColor(float height) {
    // Colors sampled from aerial photos of volcanic islands
    // Deep water -> Shallow water -> Beach -> Grass -> Mountain -> Peak

    if (height < 0.30f) {
        // Deep water (dark blue)
        Color deepWater(8, 24, 58);
        Color mediumWater(15, 40, 90);
        float t = height / 0.30f;
        return lerpColor(deepWater, mediumWater, t);
    } else if (height < 0.38f) {
        // Medium to shallow water
        Color mediumWater(15, 40, 90);
        Color shallowWater(40, 85, 150);
        float t = (height - 0.30f) / 0.08f;
        return lerpColor(mediumWater, shallowWater, t);
    } else if (height < 0.42f) {
        // Shallow water to beach
        Color shallowWater(40, 85, 150);
        Color beach(210, 190, 140);
        float t = (height - 0.38f) / 0.04f;
        return lerpColor(shallowWater, beach, t);
    } else if (height < 0.50f) {
        // Beach to coastal grass
        Color beach(210, 190, 140);
        Color coastalGrass(140, 160, 90);
        float t = (height - 0.42f) / 0.08f;
        return lerpColor(beach, coastalGrass, t);
    } else if (height < 0.65f) {
        // Coastal grass to inland vegetation
        Color coastalGrass(140, 160, 90);
        Color vegetation(80, 120, 60);
        float t = (height - 0.50f) / 0.15f;
        return lerpColor(coastalGrass, vegetation, t);
    } else if (height < 0.80f) {
        // Vegetation to volcanic rock
        Color vegetation(80, 120, 60);
        Color volcanicRock(70, 60, 55);
        float t = (height - 0.65f) / 0.15f;
        return lerpColor(vegetation, volcanicRock, t);
    } else {
        // Volcanic rock to peak
        Color volcanicRock(70, 60, 55);
        Color peak(90, 80, 75);
        float t = (height - 0.80f) / 0.20f;
        return lerpColor(volcanicRock, peak, t);
    }
}

void World::saveColoredImage(const std::string& filename,
                             const std::vector<float>& heightData) {
    std::vector<uint8_t> colorImage(width * height * 3);

    for (int i = 0; i < width * height; ++i) {
        Color c = getTerrainColor(heightData[i]);
        colorImage[i * 3 + 0] = c.r;
        colorImage[i * 3 + 1] = c.g;
        colorImage[i * 3 + 2] = c.b;
    }

    stbi_write_png(filename.c_str(), width, height, 3, colorImage.data(),
                   width * 3);
}

/* ============================================================
   PSEUDORANDOM SEED GENERATOR
   ============================================================ */
int World::generateSeed(int index) {
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
void World::generateRadialGradient() {
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

    saveFloatImageAsGrayscale(outputDirectory + "/step1_radial_gradient.png",
                              radialGradient);

    std::cout << "Step 1: Radial gradient created (island size: " << islandSize
              << ")\n";
}

/* ============================================================
   STEP 2: ORGANIC NOISE (MULTIPLE LAYERS)
   ============================================================ */
void World::generateOrganicNoise() {
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
        int octaves = 3 + (layer % 2);  // Vary octaves between 3 and 4

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
        saveFloatImageAsGrayscale(outputDirectory + "/step2_noise_layer" +
                                      std::to_string(layer + 1) + ".png",
                                  layerData);
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
        outputDirectory + "/step2_organic_noise_combined.png", organicNoise);

    std::cout << "Step 2: Generated and averaged " << numNoiseLayers
              << " noise layers (master seed: " << masterSeed << ")\n";
}

/* ============================================================
   STEP 3: AVERAGE THEM TOGETHER
   ============================================================ */
void World::averageTogether() {
    heightmap.assign(width * height, 0.0f);

    for (int i = 0; i < width * height; ++i) {
        // Weight gradient more heavily to maintain island shape
        heightmap[i] = radialGradient[i] * 0.65f + organicNoise[i] * 0.35f;
    }

    saveFloatImageAsGrayscale(outputDirectory + "/step3_averaged.png",
                              heightmap);

    std::cout << "Step 3: Averaged gradient and noise together (65% gradient, "
                 "35% noise)\n";
}

/* ============================================================
   NORMALIZE (OPTIONAL - ENSURE 0-1 RANGE)
   ============================================================ */
void World::normalizeHeightmap() {
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
void World::generateIsland(int w, int h, const std::string& outputDir) {
    width = w;
    height = h;
    outputDirectory = outputDir;

    createOutputDirectory();

    // Follow the volcanic island generation guide
    generateRadialGradient();  // Step 1: Cone shape
    generateOrganicNoise();    // Step 2: Bumpy organic pattern
    averageTogether();         // Step 3: Combine them
    normalizeHeightmap();      // Ensure proper range

    // Step 4: Colorize
    saveColoredImage(outputDirectory + "/step4_colored_island.png", heightmap);

    std::cout << "Step 4: Colored island created\n";
    std::cout << "\nVolcanic island generation complete!\n";
}

/* ============================================================
   SAVE FINAL TERRAIN IMAGE
   ============================================================ */
void World::saveFinalTerrainImage(const std::string& filename) {
    if (heightmap.empty()) {
        std::cerr << "Cannot save terrain image: heightmap is empty\n";
        return;
    }

    std::cout << "Generating final terrain image...\\n";

    // Classify biomes
    std::vector<BiomeType> biomeMap;
    classifyBiomes(biomeMap);

    // Create colored image based on biomes
    std::vector<uint8_t> colorImage(width * height * 3);

    for (int i = 0; i < width * height; ++i) {
        Color c = getBiomeColor(biomeMap[i]);
        colorImage[i * 3 + 0] = c.r;
        colorImage[i * 3 + 1] = c.g;
        colorImage[i * 3 + 2] = c.b;
    }

    stbi_write_png(filename.c_str(), width, height, 3, colorImage.data(),
                   width * 3);

    std::cout << "Saved final terrain image to: " << filename << "\\n";
}

/* ============================================================
   BIOME CLASSIFICATION
   ============================================================ */
BiomeType World::getBiomeType(float height) {
    if (height < 0.30f)
        return BIOME_DEEP_WATER;
    else if (height < 0.38f)
        return BIOME_SHALLOW_WATER;
    else if (height < 0.42f)
        return BIOME_BEACH;
    else if (height < 0.50f)
        return BIOME_GRASSLAND;
    else if (height < 0.70f)
        return BIOME_FOREST;
    else if (height < 0.85f)
        return BIOME_MOUNTAIN;
    else
        return BIOME_PEAK;
}

const char* World::getBiomeName(BiomeType type) const {
    switch (type) {
        case BIOME_DEEP_WATER:
            return "Deep Water";
        case BIOME_SHALLOW_WATER:
            return "Shallow Water";
        case BIOME_BEACH:
            return "Beach";
        case BIOME_GRASSLAND:
            return "Grassland";
        case BIOME_FOREST:
            return "Forest";
        case BIOME_MOUNTAIN:
            return "Mountain";
        case BIOME_PEAK:
            return "Peak";
        default:
            return "Unknown";
    }
}

void World::classifyBiomes(std::vector<BiomeType>& biomeMap) {
    biomeMap.resize(width * height);

    for (int i = 0; i < width * height; ++i) {
        biomeMap[i] = getBiomeType(heightmap[i]);
    }
}

/* ============================================================
   GET BIOME COLOR (FLAT COLORS FOR BIOMES)
   ============================================================ */
Color World::getBiomeColor(BiomeType type) {
    switch (type) {
        case BIOME_DEEP_WATER:
            return Color(20, 40, 100);  // Dark blue
        case BIOME_SHALLOW_WATER:
            return Color(60, 110, 180);  // Light blue
        case BIOME_BEACH:
            return Color(220, 200, 150);  // Sandy
        case BIOME_GRASSLAND:
            return Color(120, 180, 80);  // Light green
        case BIOME_FOREST:
            return Color(60, 120, 50);  // Dark green
        case BIOME_MOUNTAIN:
            return Color(100, 90, 80);  // Gray-brown
        case BIOME_PEAK:
            return Color(140, 130, 120);  // Light gray
        default:
            return Color(0, 0, 0);  // Black for unknown
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
    if (signedArea(v) < 0.0f) std::reverse(v.begin(), v.end());
}

static bool collinear(const Vec2& a, const Vec2& b, const Vec2& c) {
    float cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    return std::abs(cross) < 1e-4f;
}

static void removeCollinear(std::vector<Vec2>& v) {
    if (v.size() < 3) return;
    std::vector<Vec2> out;
    for (size_t i = 0; i < v.size(); ++i) {
        const Vec2& prev = v[(i + v.size() - 1) % v.size()];
        const Vec2& cur = v[i];
        const Vec2& next = v[(i + 1) % v.size()];
        if (!collinear(prev, cur, next)) out.push_back(cur);
    }
    v.swap(out);
}

// Replace the extractContour and marchingSquares functions with this improved
// version

// Helper to check if a pixel belongs to the target biome
static bool isBiome(const std::vector<BiomeType>& biomeMap, int width,
                    int height, int x, int y, BiomeType target) {
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    return biomeMap[y * width + x] == target;
}

// Flood fill to collect a single connected component of a biome
static std::vector<int> floodFillComponent(const std::vector<BiomeType>& map,
                                           int width, int height, int startX,
                                           int startY, BiomeType biome,
                                           std::vector<uint8_t>& visited) {
    std::vector<int> cells;
    std::deque<std::pair<int, int>> q;
    q.emplace_back(startX, startY);

    const int offsets[4][2] = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}};

    auto idx = [width](int x, int y) { return y * width + x; };

    visited[idx(startX, startY)] = 1;

    while (!q.empty()) {
        auto [x, y] = q.front();
        q.pop_front();

        cells.push_back(idx(x, y));

        for (auto& o : offsets) {
            int nx = x + o[0];
            int ny = y + o[1];
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            int nIdx = idx(nx, ny);
            if (!visited[nIdx] && map[nIdx] == biome) {
                visited[nIdx] = 1;
                q.emplace_back(nx, ny);
            }
        }
    }

    return cells;
}

// Build boundary loops (outer + holes) for a component mask
static std::vector<std::vector<Vec2>> buildLoopsFromComponent(
    const std::vector<uint8_t>& mask, int width, int height) {
    struct Edge {
        Vec2 a;
        Vec2 b;
    };

    auto idx = [width](int x, int y) { return y * width + x; };

    std::vector<Edge> edges;
    edges.reserve(mask.size());

    auto addEdge = [&](float x1, float y1, float x2, float y2) {
        edges.push_back({Vec2(x1, y1), Vec2(x2, y2)});
    };

    for (int y = 0; y < height; ++y) {
        for (int x = 0; x < width; ++x) {
            if (!mask[idx(x, y)]) continue;

            // For each of the four sides, if neighbor is empty, emit an edge.
            // Edges are on the grid line (corner coordinates).
            if (y == 0 || !mask[idx(x, y - 1)]) {  // top
                addEdge(x, y, x + 1, y);
            }
            if (x == width - 1 || !mask[idx(x + 1, y)]) {  // right
                addEdge(x + 1, y, x + 1, y + 1);
            }
            if (y == height - 1 || !mask[idx(x, y + 1)]) {  // bottom
                addEdge(x + 1, y + 1, x, y + 1);
            }
            if (x == 0 || !mask[idx(x - 1, y)]) {  // left
                addEdge(x, y + 1, x, y);
            }
        }
    }

    // Stitch edges into closed loops
    std::unordered_map<uint64_t, std::vector<size_t>> adjacency;
    adjacency.reserve(edges.size() * 2);

    auto key = [](const Vec2& v) -> uint64_t {
        int64_t ix = static_cast<int64_t>(std::lround(v.x * 1000.0f));
        int64_t iy = static_cast<int64_t>(std::lround(v.y * 1000.0f));
        return (static_cast<uint64_t>(ix & 0xffffffff) << 32) |
               static_cast<uint64_t>(iy & 0xffffffff);
    };

    for (size_t i = 0; i < edges.size(); ++i) {
        adjacency[key(edges[i].a)].push_back(i);
    }

    std::vector<uint8_t> used(edges.size(), 0);
    std::vector<std::vector<Vec2>> loops;
    loops.reserve(32);

    for (size_t i = 0; i < edges.size(); ++i) {
        if (used[i]) continue;

        std::vector<Vec2> loop;
        size_t currentIdx = i;
        Vec2 start = edges[currentIdx].a;
        Vec2 currentPoint = start;

        while (true) {
            used[currentIdx] = 1;
            const Edge& e = edges[currentIdx];
            loop.push_back(e.a);
            Vec2 nextPoint = e.b;

            if (key(nextPoint) == key(start)) {
                loop.push_back(nextPoint);
                break;
            }

            auto& outgoing = adjacency[key(nextPoint)];
            size_t nextIdx = SIZE_MAX;
            for (size_t candidate : outgoing) {
                if (!used[candidate]) {
                    nextIdx = candidate;
                    break;
                }
            }

            if (nextIdx == SIZE_MAX) {
                // Open contour (should not happen); abort this loop
                break;
            }

            currentIdx = nextIdx;
            currentPoint = nextPoint;
        }

        if (loop.size() >= 4) {
            // Remove duplicate final point to keep polygons clean
            if (loop.size() > 1) {
                const Vec2& first = loop.front();
                const Vec2& last = loop.back();
                if (std::abs(first.x - last.x) < 1e-4f &&
                    std::abs(first.y - last.y) < 1e-4f) {
                    loop.pop_back();
                }
            }
            removeCollinear(loop);
            loops.push_back(loop);
        }
    }

    return loops;
}

// Updated buildTerrainMeshes using connected components and hole-aware rings
std::vector<TerrainMesh> World::buildTerrainMeshes() {
    std::vector<TerrainMesh> meshes;

    if (heightmap.empty()) {
        std::cerr << "Error: No heightmap data. Run generateIsland() first.\n";
        return meshes;
    }

    std::cout << "\nBuilding terrain meshes from components + holes...\n";

    // Step 1: Classify biomes
    std::vector<BiomeType> classified;
    classifyBiomes(classified);

    auto idx = [this](int x, int y) { return y * this->width + x; };

    // Step 2: For each biome type, extract every connected component
    for (int b = BIOME_DEEP_WATER; b <= BIOME_PEAK; ++b) {
        BiomeType biome = static_cast<BiomeType>(b);
        std::vector<uint8_t> visited(width * height, 0);

        for (int y = 0; y < height; ++y) {
            for (int x = 0; x < width; ++x) {
                if (classified[idx(x, y)] != biome || visited[idx(x, y)])
                    continue;

                // Flood fill to get this component
                std::vector<int> componentCells = floodFillComponent(
                    classified, width, height, x, y, biome, visited);

                if (componentCells.empty()) continue;

                // Build a mask for this component
                std::vector<uint8_t> componentMask(width * height, 0);
                for (int cellIdx : componentCells) {
                    componentMask[cellIdx] = 1;
                }

                // Build boundary loops (outer + holes)
                auto loops =
                    buildLoopsFromComponent(componentMask, width, height);
                if (loops.empty()) continue;

                // Identify outer ring (max absolute area) and holes
                int outerIdx = -1;
                float maxArea = 0.0f;
                for (size_t i = 0; i < loops.size(); ++i) {
                    float a = std::abs(signedArea(loops[i]));
                    if (a > maxArea) {
                        maxArea = a;
                        outerIdx = static_cast<int>(i);
                    }
                }

                if (outerIdx == -1 || maxArea < 1e-3f) continue;

                // Prepare polygon rings for earcut
                using Coord = float;
                using N = uint32_t;
                std::vector<std::vector<std::array<Coord, 2>>> polygon;

                // Outer ring: ensure CCW
                enforceCCW(loops[outerIdx]);
                polygon.push_back({});
                for (const auto& v : loops[outerIdx]) {
                    polygon.back().push_back({v.x, v.y});
                }

                // Holes: ensure CW
                for (size_t i = 0; i < loops.size(); ++i) {
                    if (static_cast<int>(i) == outerIdx) continue;
                    std::vector<Vec2> hole = loops[i];
                    if (signedArea(hole) > 0.0f) {
                        std::reverse(hole.begin(), hole.end());
                    }
                    polygon.push_back({});
                    for (const auto& v : hole) {
                        polygon.back().push_back({v.x, v.y});
                    }
                }

                // Flatten vertices in the same order earcut expects
                std::vector<Vec2> meshVertices;
                meshVertices.reserve(width + height);  // rough guess
                for (const auto& ring : polygon) {
                    for (const auto& p : ring) {
                        meshVertices.emplace_back(p[0], p[1]);
                    }
                }

                std::vector<N> indices = mapbox::earcut<N>(polygon);
                if (indices.empty() || indices.size() % 3 != 0) {
                    std::cout << "  Skipping component of "
                              << getBiomeName(biome)
                              << " (triangulation failed)\n";
                    continue;
                }

                // Filter degenerate triangles
                std::vector<N> validIndices;
                validIndices.reserve(indices.size());
                for (size_t i = 0; i < indices.size(); i += 3) {
                    N a = indices[i];
                    N b = indices[i + 1];
                    N c = indices[i + 2];

                    if (a >= meshVertices.size() || b >= meshVertices.size() ||
                        c >= meshVertices.size()) {
                        continue;
                    }

                    const Vec2& va = meshVertices[a];
                    const Vec2& vb = meshVertices[b];
                    const Vec2& vc = meshVertices[c];

                    float area = (vb.x - va.x) * (vc.y - va.y) -
                                 (vb.y - va.y) * (vc.x - va.x);
                    if (std::abs(area) < 1e-4f) continue;

                    validIndices.push_back(a);
                    validIndices.push_back(b);
                    validIndices.push_back(c);
                }

                if (validIndices.empty()) continue;

                TerrainMesh mesh;
                mesh.biome = biome;
                mesh.vertices = std::move(meshVertices);
                mesh.indices = std::move(validIndices);

                std::cout << "  " << getBiomeName(biome)
                          << " component: " << mesh.vertices.size()
                          << " verts, " << (mesh.indices.size() / 3)
                          << " tris\n";

                meshes.push_back(std::move(mesh));
            }
        }
    }

    // Optional debug raster: draw the triangulated meshes to a PNG so we can
    // visually compare against the original heightmap render.
    if (!meshes.empty() && !outputDirectory.empty()) {
        std::vector<uint8_t> img(width * height * 3, 0);

        auto insideTri = [](float px, float py, const Vec2& a, const Vec2& b,
                            const Vec2& c) {
            float area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
            if (std::abs(area) < 1e-6f) return false;
            float w1 =
                ((b.y - c.y) * (px - c.x) + (c.x - b.x) * (py - c.y)) / area;
            float w2 =
                ((c.y - a.y) * (px - c.x) + (a.x - c.x) * (py - c.y)) / area;
            float w3 = 1.0f - w1 - w2;
            return w1 >= 0.0f && w2 >= 0.0f && w3 >= 0.0f;
        };

        auto putPixel = [&](int x, int y, const Color& c) {
            if (x < 0 || y < 0 || x >= width || y >= height) return;
            size_t idx = (y * width + x) * 3;
            img[idx + 0] = c.r;
            img[idx + 1] = c.g;
            img[idx + 2] = c.b;
        };

        for (const auto& mesh : meshes) {
            Color c = getBiomeColor(mesh.biome);
            for (size_t i = 0; i + 2 < mesh.indices.size(); i += 3) {
                const Vec2& a = mesh.vertices[mesh.indices[i]];
                const Vec2& b = mesh.vertices[mesh.indices[i + 1]];
                const Vec2& d = mesh.vertices[mesh.indices[i + 2]];

                float minX = std::floor(std::min({a.x, b.x, d.x}));
                float maxX = std::ceil(std::max({a.x, b.x, d.x}));
                float minY = std::floor(std::min({a.y, b.y, d.y}));
                float maxY = std::ceil(std::max({a.y, b.y, d.y}));

                for (int y = static_cast<int>(minY);
                     y <= static_cast<int>(maxY); ++y) {
                    for (int x = static_cast<int>(minX);
                         x <= static_cast<int>(maxX); ++x) {
                        float px = x + 0.5f;
                        float py = y + 0.5f;
                        if (insideTri(px, py, a, b, d)) {
                            putPixel(x, y, c);
                        }
                    }
                }
            }
        }

        stbi_write_png((outputDirectory + "/debug_meshes.png").c_str(), width,
                       height, 3, img.data(), width * 3);
    }

    std::cout << "Generated " << meshes.size() << " terrain meshes\n";
    return meshes;
}

/* ============================================================
   SAVE TERRAIN MESHES TO JSON
   ============================================================ */

void World::saveTerrainMeshesJSON(const std::vector<TerrainMesh>& meshes,
                                  const std::string& filename) {
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

/* ============================================================
   BOX2D PHYSICS INTEGRATION
   ============================================================ */

void World::BuildMeshPhysics(const std::vector<TerrainMesh>& meshes,
                             b2WorldId physicsWorldId) {
    std::cout << "Building Box2D physics from terrain meshes...\n";

    // Cache the biome map for fast lookups
    classifyBiomes(biomeMap);

    // Create a single static body to hold all terrain shapes
    b2BodyDef bodyDef = b2DefaultBodyDef();
    bodyDef.type = b2_staticBody;
    bodyDef.position = {0.0f, 0.0f};
    b2BodyId terrainBody = b2CreateBody(physicsWorldId, &bodyDef);

    int totalShapes = 0;

    // Create physics for ALL terrain (including water for visibility queries)
    for (size_t meshIdx = 0; meshIdx < meshes.size(); ++meshIdx) {
        const auto& mesh = meshes[meshIdx];

        // Create triangles from the mesh indices
        for (size_t i = 0; i < mesh.indices.size(); i += 3) {
            uint32_t idx0 = mesh.indices[i];
            uint32_t idx1 = mesh.indices[i + 1];
            uint32_t idx2 = mesh.indices[i + 2];

            // Validate indices
            if (idx0 >= mesh.vertices.size() || idx1 >= mesh.vertices.size() ||
                idx2 >= mesh.vertices.size()) {
                continue;
            }

            const Vec2& v0 = mesh.vertices[idx0];
            const Vec2& v1 = mesh.vertices[idx1];
            const Vec2& v2 = mesh.vertices[idx2];

            // Validate triangle (check for degenerate cases)
            float dx1 = v1.x - v0.x;
            float dy1 = v1.y - v0.y;
            float dx2 = v2.x - v0.x;
            float dy2 = v2.y - v0.y;
            float area = std::abs(dx1 * dy2 - dy1 * dx2);

            // Skip degenerate triangles (too small area)
            if (area < 0.01f) {
                continue;
            }

            // Create polygon shape for this triangle
            b2Vec2 vertices[3];
            vertices[0] = {meters(v0.x * 64.0f), meters(v0.y * 64.0f)};
            vertices[1] = {meters(v1.x * 64.0f), meters(v1.y * 64.0f)};
            vertices[2] = {meters(v2.x * 64.0f), meters(v2.y * 64.0f)};

            // Validate that vertices are not too close together
            float d01 = (vertices[1].x - vertices[0].x) *
                            (vertices[1].x - vertices[0].x) +
                        (vertices[1].y - vertices[0].y) *
                            (vertices[1].y - vertices[0].y);
            float d12 = (vertices[2].x - vertices[1].x) *
                            (vertices[2].x - vertices[1].x) +
                        (vertices[2].y - vertices[1].y) *
                            (vertices[2].y - vertices[1].y);
            float d20 = (vertices[0].x - vertices[2].x) *
                            (vertices[0].x - vertices[2].x) +
                        (vertices[0].y - vertices[2].y) *
                            (vertices[0].y - vertices[2].y);

            const float minDistSq =
                0.0001f;  // Minimum distance squared between vertices
            if (d01 < minDistSq || d12 < minDistSq || d20 < minDistSq) {
                continue;
            }

            // In v3, b2MakePolygon needs a b2Hull, so we create it from the
            // vertices
            b2Hull hull = b2ComputeHull(vertices, 3);

            // Validate hull before using it
            if (hull.count < 3) {
                continue;  // Invalid hull, skip this triangle
            }

            b2Polygon triangle = b2MakePolygon(&hull, 0.0f);

            // Create shape definition
            b2ShapeDef shapeDef = b2DefaultShapeDef();
            shapeDef.isSensor =
                true;  // All terrain is sensor for visibility queries

            // Attach mesh index as user data so we can identify which mesh this
            // shape belongs to
            TerrainShapeUserData* userData = new TerrainShapeUserData();
            userData->meshIndex = meshIdx;
            shapeDef.userData = reinterpret_cast<void*>(userData);

            b2CreatePolygonShape(terrainBody, &shapeDef, &triangle);
            totalShapes++;
        }
    }

    std::cout << "Created " << totalShapes << " physics shapes from "
              << meshes.size() << " terrain meshes\n";
}

/* ============================================================
   GET BIOME AT POSITION
   ============================================================ */
BiomeType World::GetBiomeAtPosition(float worldX, float worldY) const {
    if (biomeMap.empty()) {
        return BIOME_DEEP_WATER;  // Default if not initialized
    }

    // Convert game world coordinates (in pixels) to heightmap indices
    // Game world is 512 * 64 pixels (32768 pixels total)
    // Heightmap is 512 x 512 indices
    int x = static_cast<int>(worldX / 64.0f);
    int y = static_cast<int>(worldY / 64.0f);

    // Clamp to bounds
    x = std::max(0, std::min(x, width - 1));
    y = std::max(0, std::min(y, height - 1));

    // Look up biome in map
    int idx = y * width + x;
    if (idx >= 0 && idx < static_cast<int>(biomeMap.size())) {
        return biomeMap[idx];
    }

    return BIOME_DEEP_WATER;  // Default fallback
}

/* ============================================================
   GET BIOME NAME (PUBLIC WRAPPER)
   ============================================================ */
const char* World::GetBiomeName(BiomeType type) const {
    return getBiomeName(type);
}