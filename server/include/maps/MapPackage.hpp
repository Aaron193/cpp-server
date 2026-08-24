#pragma once

#include <cstdint>
#include <filesystem>
#include <string>
#include <stdexcept>
#include <vector>

#include <glm/vec3.hpp>

struct CollisionMesh3D {
    glm::vec3 boundsMin{};
    glm::vec3 boundsMax{};
    std::vector<glm::vec3> vertices;
    std::vector<std::uint32_t> indices;
};

struct MapSpawnPoint {
    std::string id;
    glm::vec3 position{};
    float yaw = 0.0F;
};

struct MapManifest {
    std::string mapId;
    std::uint32_t formatVersion = 0;
    glm::vec3 boundsMin{};
    glm::vec3 boundsMax{};
    std::string renderAsset;
    std::string collisionAsset;
    std::string contentHash;
    std::vector<MapSpawnPoint> spawnPoints;
};

struct MapPackage {
    std::filesystem::path directory;
    MapManifest manifest;
    CollisionMesh3D collision;
};

class MapLoadError : public std::runtime_error {
   public:
    using std::runtime_error::runtime_error;
};

class MapPackageLoader {
   public:
    static CollisionMesh3D parseCollision(
        const std::vector<std::uint8_t>& bytes);
    static MapManifest parseManifest(const std::string& jsonText);
    static MapPackage load(const std::filesystem::path& directory);
};
