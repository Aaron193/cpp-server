#include "maps/MapPackage.hpp"

#include <cmath>
#include <cstring>
#include <fstream>
#include <limits>
#include <nlohmann/json.hpp>

#include "util/Sha256.hpp"

namespace {

constexpr std::size_t kHeaderSize = 40;
constexpr std::uint16_t kCollisionVersion = 1;
constexpr std::uint32_t kManifestVersion = 1;

std::vector<std::uint8_t> readBytes(const std::filesystem::path& path) {
    std::ifstream input(path, std::ios::binary | std::ios::ate);
    if (!input) throw MapLoadError("cannot open map asset: " + path.string());
    const auto end = input.tellg();
    if (end < 0) throw MapLoadError("cannot size map asset: " + path.string());
    std::vector<std::uint8_t> bytes(static_cast<std::size_t>(end));
    input.seekg(0);
    if (!bytes.empty() &&
        !input.read(reinterpret_cast<char*>(bytes.data()), end)) {
        throw MapLoadError("cannot read map asset: " + path.string());
    }
    return bytes;
}

std::string readText(const std::filesystem::path& path) {
    const auto bytes = readBytes(path);
    return {bytes.begin(), bytes.end()};
}

std::uint16_t u16(const std::vector<std::uint8_t>& data, std::size_t at) {
    return static_cast<std::uint16_t>(data[at]) |
           static_cast<std::uint16_t>(data[at + 1] << 8U);
}

std::uint32_t u32(const std::vector<std::uint8_t>& data, std::size_t at) {
    return static_cast<std::uint32_t>(data[at]) |
           (static_cast<std::uint32_t>(data[at + 1]) << 8U) |
           (static_cast<std::uint32_t>(data[at + 2]) << 16U) |
           (static_cast<std::uint32_t>(data[at + 3]) << 24U);
}

float f32(const std::vector<std::uint8_t>& data, std::size_t at) {
    const std::uint32_t bits = u32(data, at);
    float result;
    std::memcpy(&result, &bits, sizeof(result));
    return result;
}

bool finiteVec(const glm::vec3& value) {
    return std::isfinite(value.x) && std::isfinite(value.y) &&
           std::isfinite(value.z);
}

bool inside(const glm::vec3& point, const glm::vec3& min,
            const glm::vec3& max) {
    return point.x >= min.x && point.x <= max.x && point.y >= min.y &&
           point.y <= max.y && point.z >= min.z && point.z <= max.z;
}

glm::vec3 jsonVec3(const nlohmann::json& value, const char* label) {
    if (!value.is_array() || value.size() != 3) {
        throw MapLoadError(std::string(label) + " must be a three-number array");
    }
    glm::vec3 result;
    for (std::size_t i = 0; i < 3; ++i) {
        if (!value[i].is_number()) {
            throw MapLoadError(std::string(label) + " must contain numbers");
        }
        result[i] = value[i].get<float>();
    }
    if (!finiteVec(result)) {
        throw MapLoadError(std::string(label) + " contains a non-finite value");
    }
    return result;
}

}  // namespace

CollisionMesh3D MapPackageLoader::parseCollision(
    const std::vector<std::uint8_t>& bytes) {
    if (bytes.size() < kHeaderSize) throw MapLoadError("M3CL header is truncated");
    if (std::memcmp(bytes.data(), "M3CL", 4) != 0) throw MapLoadError("invalid M3CL magic");
    if (u16(bytes, 4) != kCollisionVersion) throw MapLoadError("unsupported M3CL version");
    if (u16(bytes, 6) != 0) throw MapLoadError("unsupported M3CL flags");
    const std::uint32_t vertexCount = u32(bytes, 8);
    const std::uint32_t indexCount = u32(bytes, 12);
    if (vertexCount == 0 || indexCount == 0) throw MapLoadError("M3CL mesh is empty");
    if (indexCount % 3 != 0) throw MapLoadError("M3CL index count is not divisible by three");
    const std::uint64_t expected = kHeaderSize + static_cast<std::uint64_t>(vertexCount) * 12U +
                                   static_cast<std::uint64_t>(indexCount) * 4U;
    if (expected != bytes.size()) throw MapLoadError(expected > bytes.size() ? "M3CL payload is truncated" : "M3CL has trailing data");

    CollisionMesh3D mesh;
    mesh.boundsMin = {f32(bytes, 16), f32(bytes, 20), f32(bytes, 24)};
    mesh.boundsMax = {f32(bytes, 28), f32(bytes, 32), f32(bytes, 36)};
    if (!finiteVec(mesh.boundsMin) || !finiteVec(mesh.boundsMax) ||
        mesh.boundsMin.x > mesh.boundsMax.x || mesh.boundsMin.y > mesh.boundsMax.y ||
        mesh.boundsMin.z > mesh.boundsMax.z) throw MapLoadError("M3CL bounds are invalid");
    mesh.vertices.reserve(vertexCount);
    std::size_t offset = kHeaderSize;
    for (std::uint32_t i = 0; i < vertexCount; ++i, offset += 12) {
        const glm::vec3 vertex{f32(bytes, offset), f32(bytes, offset + 4), f32(bytes, offset + 8)};
        if (!finiteVec(vertex)) throw MapLoadError("M3CL vertex is non-finite");
        if (!inside(vertex, mesh.boundsMin, mesh.boundsMax)) throw MapLoadError("M3CL vertex is outside declared bounds");
        mesh.vertices.push_back(vertex);
    }
    mesh.indices.reserve(indexCount);
    for (std::uint32_t i = 0; i < indexCount; ++i, offset += 4) {
        const auto index = u32(bytes, offset);
        if (index >= vertexCount) throw MapLoadError("M3CL index is outside vertex array");
        mesh.indices.push_back(index);
    }
    return mesh;
}

MapManifest MapPackageLoader::parseManifest(const std::string& jsonText) {
    nlohmann::json root;
    try { root = nlohmann::json::parse(jsonText); }
    catch (const nlohmann::json::exception& error) { throw MapLoadError(std::string("invalid map manifest JSON: ") + error.what()); }
    if (!root.is_object() || root.value("format", "") != "cpp-server-map" ||
        root.value("formatVersion", 0U) != kManifestVersion) throw MapLoadError("unsupported map manifest format or version");
    const auto& coordinates = root.at("coordinateSystem");
    if (coordinates.value("handedness", "") != "right" || coordinates.value("upAxis", "") != "Y" ||
        coordinates.value("units", "") != "meters") throw MapLoadError("map coordinate system must be right-handed, Y-up, meters");
    MapManifest manifest;
    manifest.formatVersion = kManifestVersion;
    manifest.mapId = root.at("mapId").get<std::string>();
    manifest.renderAsset = root.at("renderAsset").get<std::string>();
    manifest.collisionAsset = root.at("collisionAsset").get<std::string>();
    manifest.contentHash = root.at("contentHash").get<std::string>();
    if (manifest.mapId.empty() || manifest.renderAsset.empty() || manifest.collisionAsset.empty() ||
        manifest.contentHash.rfind("sha256:", 0) != 0 || manifest.contentHash.size() != 71) throw MapLoadError("manifest identifiers, assets, or hash are invalid");
    manifest.boundsMin = jsonVec3(root.at("worldBounds").at("min"), "worldBounds.min");
    manifest.boundsMax = jsonVec3(root.at("worldBounds").at("max"), "worldBounds.max");
    if (manifest.boundsMin.x > manifest.boundsMax.x || manifest.boundsMin.y > manifest.boundsMax.y || manifest.boundsMin.z > manifest.boundsMax.z) throw MapLoadError("manifest world bounds are inverted");
    const auto& spawns = root.at("spawnPoints");
    if (!spawns.is_array() || spawns.empty()) throw MapLoadError("manifest has no spawn points");
    for (const auto& entry : spawns) {
        MapSpawnPoint spawn;
        spawn.id = entry.at("id").get<std::string>();
        spawn.position = jsonVec3(entry.at("position"), "spawn.position");
        spawn.yaw = entry.at("yaw").get<float>();
        if (spawn.id.empty() || !std::isfinite(spawn.yaw) || !inside(spawn.position, manifest.boundsMin, manifest.boundsMax)) throw MapLoadError("manifest spawn is invalid or outside world bounds");
        manifest.spawnPoints.push_back(std::move(spawn));
    }
    return manifest;
}

MapPackage MapPackageLoader::load(const std::filesystem::path& directory) {
    const auto manifestText = readText(directory / "manifest.json");
    MapPackage package{directory, parseManifest(manifestText), {}};
    const auto collisionBytes = readBytes(directory / package.manifest.collisionAsset);
    const auto sceneBytes = readBytes(directory / package.manifest.renderAsset);
    package.collision = parseCollision(collisionBytes);
    if (package.collision.boundsMin != package.manifest.boundsMin || package.collision.boundsMax != package.manifest.boundsMax) throw MapLoadError("collision and manifest bounds differ");

    auto json = nlohmann::json::parse(manifestText);
    json.erase("contentHash");
    const std::string canonical = json.dump();
    util::Sha256 hash;
    hash.update(reinterpret_cast<const std::uint8_t*>(canonical.data()), canonical.size());
    hash.update(sceneBytes.data(), sceneBytes.size());
    hash.update(collisionBytes.data(), collisionBytes.size());
    if ("sha256:" + hash.finishHex() != package.manifest.contentHash) throw MapLoadError("map package content hash mismatch");
    return package;
}
