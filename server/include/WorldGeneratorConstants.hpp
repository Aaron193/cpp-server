#pragma once

namespace WorldGenConstants {
    // Heightmap generation
    constexpr float ISLAND_CENTER_X_RATIO = 0.5f;
    constexpr float ISLAND_CENTER_Y_RATIO = 0.5f;
    constexpr float ISLAND_RADIUS_RATIO = 0.44f;
    constexpr float HEIGHT_GRADIENT_WEIGHT = 1.33f;  // 57% gradient, 43% noise
    
    // Precipitation
    constexpr float RAIN_SHADOW_RADIUS_RATIO = 0.33f;
    constexpr float WIND_OFFSET_RANGE = 0.08f;
    constexpr float PRECIPITATION_NOISE_WEIGHT = 2.5f;  // 71% noise, 29% rain shadow
    
    // Temperature
    constexpr float TEMPERATURE_GRADIENT_WEIGHT = 1.5f;  // 60% gradient, 40% noise
    constexpr float ELEVATION_COOLING_FACTOR = 1.0f;
    constexpr float ELEVATION_COOLING_OFFSET = 0.16f;
    
    // Biome thresholds
    constexpr float SEA_LEVEL_NORMALIZED = 0.0f;
    constexpr float BEACH_LEVEL_NORMALIZED = 0.18f;
    constexpr float MOUNTAIN_LEVEL_NORMALIZED = 0.75f;
    constexpr float TEMP_COLD_THRESHOLD = -0.25f;
    constexpr float TEMP_HOT_THRESHOLD = 0.25f;
    constexpr float TEMP_GLACIER_THRESHOLD = -0.66f;
    constexpr float TEMP_SNOW_THRESHOLD = -0.55f;
    constexpr float PRECIP_LOW = -0.25f;
    constexpr float PRECIP_MED_LOW = 0.0f;
    constexpr float PRECIP_MED = 0.25f;
    constexpr float PRECIP_HIGH = 0.5f;
    
    // Erosion parameters
    constexpr int DEFAULT_DROPLET_COUNT = 30000;
    constexpr int DEFAULT_MAX_STEPS = 100;
    constexpr int SLOPE_RECOMPUTE_INTERVAL = 500;
    constexpr float EROSION_INERTIA = 0.05f;
    constexpr float EROSION_CAPACITY = 4.0f;
    constexpr float EROSION_RATE = 0.3f;
    constexpr float DEPOSITION_RATE = 0.3f;
    constexpr float EVAPORATION_RATE = 0.01f;
    constexpr float EROSION_GRAVITY = 4.0f;
    constexpr float MIN_EROSION_SLOPE = 0.01f;
    constexpr int EROSION_BRUSH_RADIUS = 3;
    
    // River generation
    constexpr float RIVER_NOISE_FREQUENCY = 0.05f;
    constexpr float RIVER_TARGET_BIAS = 0.7f;
    constexpr float RIVER_NOISE_BIAS = 0.3f;
    constexpr int RIVER_MAX_LENGTH = 5000;
    constexpr int RIVER_WIDTH = 3;
    
    // Structure density multipliers
    constexpr float HOUSE_DENSITY_MULTIPLIER = 0.1f;
    constexpr float TOWN_CHANCE = 0.3f;
    constexpr int TOWN_MIN_BUILDINGS = 5;
    constexpr int TOWN_MAX_BUILDINGS = 12;
    constexpr int TOWN_SPREAD_RADIUS = 15;
    
    constexpr float RAINFOREST_TREE_DENSITY = 12.0f;
    constexpr float FOREST_TREE_DENSITY = 8.0f;
    constexpr float FRONTIER_TREE_DENSITY = 3.0f;
    constexpr float MOUNTAIN_ROCK_DENSITY = 8.0f;
    constexpr float DESERT_ROCK_DENSITY = 5.0f;
    constexpr float HIGHLAND_ROCK_DENSITY = 2.0f;
    constexpr float GRASSLAND_BUSH_DENSITY = 5.0f;
    
    // Noise octaves and frequencies
    constexpr int FRACTAL_OCTAVES = 8;
    constexpr float FRACTAL_FREQUENCIES[8] = {
        1.0f, 2.0f, 4.0f, 8.0f,
        16.0f, 32.0f, 64.0f, 128.0f
    };
    constexpr float FRACTAL_WEIGHTS[8] = {
        1.0f/2.0f, 1.0f/4.0f, 1.0f/8.0f, 1.0f/16.0f,
        1.0f/32.0f, 1.0f/64.0f, 1.0f/128.0f, 1.0f/256.0f
    };
    
    // Tiling for cache optimization
    constexpr int NOISE_TILE_SIZE = 4;
}