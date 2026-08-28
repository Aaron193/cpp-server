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
    std::vector<std::string> modes{"ffa"};
    std::string team;
    float weight = 1.0F;
    float clearanceRadius = 0.45F;
};

struct MapMarker { std::string id; std::string type; glm::vec3 position{}; };
struct MapZone { std::string id; std::string type; glm::vec3 min{}; glm::vec3 max{}; };

struct MapManifest {
    std::string mapId;
    std::uint32_t formatVersion = 0;
    glm::vec3 boundsMin{};
    glm::vec3 boundsMax{};
    std::string renderAsset;
    std::string collisionAsset;
    std::string contentHash;
    std::vector<MapSpawnPoint> spawnPoints;
    std::vector<MapMarker> markers;
    std::vector<MapZone> zones;
    std::string gameplayAsset;
    std::string navigationAsset;
    std::string radarAsset;
    std::string debugAsset;
    std::vector<std::pair<std::string, std::string>> assetHashes;
    glm::vec3 clearColor{0.055F, 0.075F, 0.11F};
    float exposure = 1.0F;
    glm::vec3 sunDirection{-0.4F, -1.0F, 0.3F};
    float shadowDistance = 80.0F;
    float stepSmoothingMax = 0.45F;
    float audioDistanceScale = 1.0F;
    float radarNorthYaw = 0.0F;
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
