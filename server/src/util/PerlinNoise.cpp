#include "util/PerlinNoise.hpp"

#include <algorithm>
#include <cmath>
#include <random>

PerlinNoise::PerlinNoise(uint32_t seed) {
    generatePermutation(seed);
}

void PerlinNoise::generatePermutation(uint32_t seed) {
    // Initialize permutation table with values 0-255
    permutation.resize(512);
    std::vector<int> p(256);
    
    for (int i = 0; i < 256; i++) {
        p[i] = i;
    }

    // Shuffle using seeded random
    std::mt19937 rng(seed);
    std::shuffle(p.begin(), p.end(), rng);

    // Duplicate for wrapping
    for (int i = 0; i < 256; i++) {
        permutation[i] = p[i];
        permutation[256 + i] = p[i];
    }
}

float PerlinNoise::fade(float t) const {
    // 6t^5 - 15t^4 + 10t^3
    return t * t * t * (t * (t * 6.0f - 15.0f) + 10.0f);
}

float PerlinNoise::lerp(float t, float a, float b) const {
    return a + t * (b - a);
}

float PerlinNoise::grad(int hash, float x, float y) const {
    // Convert hash to one of 16 gradient directions
    int h = hash & 15;
    float u = h < 8 ? x : y;
    float v = h < 4 ? y : (h == 12 || h == 14 ? x : 0.0f);
    return ((h & 1) == 0 ? u : -u) + ((h & 2) == 0 ? v : -v);
}

float PerlinNoise::noise(float x, float y) const {
    // Find unit square that contains point
    int X = static_cast<int>(std::floor(x)) & 255;
    int Y = static_cast<int>(std::floor(y)) & 255;

    // Find relative x, y in square
    x -= std::floor(x);
    y -= std::floor(y);

    // Compute fade curves
    float u = fade(x);
    float v = fade(y);

    // Hash coordinates of the 4 square corners
    int aa = permutation[permutation[X] + Y];
    int ab = permutation[permutation[X] + Y + 1];
    int ba = permutation[permutation[X + 1] + Y];
    int bb = permutation[permutation[X + 1] + Y + 1];

    // Blend results from the 4 corners
    float x1 = lerp(u, grad(aa, x, y), grad(ba, x - 1.0f, y));
    float x2 = lerp(u, grad(ab, x, y - 1.0f), grad(bb, x - 1.0f, y - 1.0f));

    return lerp(v, x1, x2);
}

float PerlinNoise::fractal(float x, float y, int octaves, float persistence) const {
    float total = 0.0f;
    float frequency = 1.0f;
    float amplitude = 1.0f;
    float maxValue = 0.0f;

    for (int i = 0; i < octaves; i++) {
        total += noise(x * frequency, y * frequency) * amplitude;
        maxValue += amplitude;
        amplitude *= persistence;
        frequency *= 2.0f;
    }

    return total / maxValue;
}
