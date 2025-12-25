#pragma once

#include <cstdint>
#include <vector>

/**
 * Perlin Noise implementation with seeded random generation
 */
class PerlinNoise {
   public:
    explicit PerlinNoise(uint32_t seed);

    // Get noise value at (x, y) - returns value in range [-1, 1]
    float noise(float x, float y) const;

    // Get fractal noise with multiple octaves
    float fractal(float x, float y, int octaves, float persistence) const;

   private:
    std::vector<uint8_t> permutation;

    // Generate deterministic permutation table from seed
    void generatePermutation(uint32_t seed);

    // Fade function for smooth interpolation
    float fade(float t) const;

    // Linear interpolation
    float lerp(float t, float a, float b) const;

    // Gradient function
    float grad(int hash, float x, float y) const;
};
