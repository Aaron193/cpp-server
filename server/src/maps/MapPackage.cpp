#include "maps/MapPackage.hpp"

#include <cmath>
#include <cstring>
#include <fstream>
#include <limits>
#include <regex>
#include <set>
#include <algorithm>
#include <nlohmann/json.hpp>

#include "util/Sha256.hpp"

namespace {

constexpr std::size_t kHeaderSize = 40;
constexpr std::uint16_t kCollisionVersion = 1;
constexpr std::uint32_t kManifestVersion = 2;
constexpr std::uint32_t kMaxVertices = 1'000'000;
constexpr std::uint32_t kMaxIndices = 3'000'000;

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

void exactKeys(const nlohmann::json& value,
               std::initializer_list<const char*> keys, const char* label) {
    if (!value.is_object()) throw MapLoadError(std::string(label) + " must be an object");
    std::set<std::string> expected;
    for (const char* key : keys) expected.emplace(key);
    for (const auto& [key, ignored] : value.items())
        if (expected.erase(key) == 0U)
            throw MapLoadError(std::string(label) + " has unsupported property: " + key);
    if (!expected.empty()) throw MapLoadError(std::string(label) + " is missing property: " + *expected.begin());
}

bool validId(const std::string& value) {
    static const std::regex pattern("^[a-z][a-z0-9-]{0,63}$");
    return std::regex_match(value, pattern);
}
bool validAsset(const std::string& value) {
    static const std::regex pattern("^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$");
    return std::regex_match(value, pattern) && value.find("..") == std::string::npos;
}
bool validHash(const std::string& value) {
    static const std::regex pattern("^sha256:[a-f0-9]{64}$");
    return std::regex_match(value, pattern);
}
float ranged(const nlohmann::json& value, const char* label, float min, float max) {
    if (!value.is_number()) throw MapLoadError(std::string(label) + " must be numeric");
    const float result = value.get<float>();
    if (!std::isfinite(result) || result < min || result > max) throw MapLoadError(std::string(label) + " is outside its finite range");
    return result;
}

void parseGameplayV2(MapManifest& manifest, const nlohmann::json& root) {
    exactKeys(root, {"format", "formatVersion", "mapId", "spawnPoints", "markers", "zones"}, "gameplay");
    if (root.at("format") != "cpp-server-map-gameplay" || root.at("formatVersion") != 2U || root.at("mapId") != manifest.mapId)
        throw MapLoadError("gameplay metadata format or map id mismatch");
    const auto& spawns = root.at("spawnPoints");
    if (!spawns.is_array() || spawns.size() < 12U || spawns.size() > 4096U) throw MapLoadError("gameplay spawn count is invalid");
    std::set<std::string> ids;
    for (const auto& entry : spawns) {
        exactKeys(entry, {"id", "position", "yaw", "modes", "team", "weight", "clearanceRadius"}, "spawn");
        MapSpawnPoint spawn;
        spawn.id = entry.at("id").get<std::string>(); spawn.position = jsonVec3(entry.at("position"), "spawn.position");
        spawn.yaw = ranged(entry.at("yaw"), "spawn.yaw", -6.283186F, 6.283186F);
        spawn.weight = ranged(entry.at("weight"), "spawn.weight", 0.0001F, 100.0F);
        spawn.clearanceRadius = ranged(entry.at("clearanceRadius"), "spawn.clearanceRadius", 0.2F, 5.0F);
        if (!validId(spawn.id) || !ids.insert(spawn.id).second || !inside(spawn.position, manifest.boundsMin, manifest.boundsMax)) throw MapLoadError("spawn id or bounds are invalid");
        const auto& modes = entry.at("modes");
        if (!modes.is_array() || modes.empty() || modes.size() > 16U) throw MapLoadError("spawn modes are invalid");
        spawn.modes.clear(); for (const auto& mode : modes) { const auto text = mode.get<std::string>(); if (!validId(text)) throw MapLoadError("spawn mode is invalid"); spawn.modes.push_back(text); }
        if (!entry.at("team").is_null()) { spawn.team = entry.at("team").get<std::string>(); if (!validId(spawn.team)) throw MapLoadError("spawn team is invalid"); }
        manifest.spawnPoints.push_back(std::move(spawn));
    }
    const auto& markers = root.at("markers");
    if (!markers.is_array() || markers.size() > 8192U) throw MapLoadError("marker count is invalid");
    for (const auto& entry : markers) { exactKeys(entry, {"id", "type", "position"}, "marker"); MapMarker marker{entry.at("id").get<std::string>(), entry.at("type").get<std::string>(), jsonVec3(entry.at("position"), "marker.position")}; if (!validId(marker.id) || !inside(marker.position, manifest.boundsMin, manifest.boundsMax) || (marker.type != "landmark" && marker.type != "pickup" && marker.type != "objective" && marker.type != "callout")) throw MapLoadError("marker is invalid"); manifest.markers.push_back(std::move(marker)); }
    const auto& zones = root.at("zones");
    if (!zones.is_array() || zones.size() > 2048U) throw MapLoadError("zone count is invalid");
    for (const auto& entry : zones) { exactKeys(entry, {"id", "type", "min", "max"}, "zone"); MapZone zone{entry.at("id").get<std::string>(), entry.at("type").get<std::string>(), jsonVec3(entry.at("min"), "zone.min"), jsonVec3(entry.at("max"), "zone.max")}; const bool knownType = zone.type == "playable" || zone.type == "kill" || zone.type == "objective" || zone.type == "audio" || zone.type == "reverb" || zone.type == "projectile-fence"; if (!validId(zone.id) || !knownType || !inside(zone.min, manifest.boundsMin, manifest.boundsMax) || !inside(zone.max, manifest.boundsMin, manifest.boundsMax) || zone.min.x >= zone.max.x || zone.min.y >= zone.max.y || zone.min.z >= zone.max.z) throw MapLoadError("zone is invalid"); manifest.zones.push_back(std::move(zone)); }
}

void validateNavigationV2(const nlohmann::json& root,
                          const MapManifest& manifest) {
    exactKeys(root, {"format", "formatVersion", "mapId", "nodes"}, "navigation");
    if (root.at("format") != "cpp-server-map-navigation" || root.at("formatVersion") != 2U || root.at("mapId") != manifest.mapId) throw MapLoadError("navigation format or map id mismatch");
    const auto& nodes = root.at("nodes"); if (!nodes.is_array() || nodes.empty() || nodes.size() > 8192U) throw MapLoadError("navigation count is invalid");
    std::set<std::string> ids;
    for (const auto& entry : nodes) { exactKeys(entry, {"id", "position", "links"}, "navigation node"); const auto id = entry.at("id").get<std::string>(); const auto position = jsonVec3(entry.at("position"), "navigation.position"); const auto& links = entry.at("links"); if (!validId(id) || !ids.insert(id).second || !inside(position, manifest.boundsMin, manifest.boundsMax) || !links.is_array() || links.size() > 32U) throw MapLoadError("navigation node is invalid"); }
    for (const auto& entry : nodes) for (const auto& link : entry.at("links")) if (!link.is_string() || ids.count(link.get<std::string>()) == 0U) throw MapLoadError("navigation link target is invalid");
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
    if (vertexCount > kMaxVertices || indexCount > kMaxIndices) throw MapLoadError("M3CL count exceeds runtime budget");
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
    for (std::size_t i = 0; i < mesh.indices.size(); i += 3U) {
        const glm::vec3 ab = mesh.vertices[mesh.indices[i + 1U]] - mesh.vertices[mesh.indices[i]];
        const glm::vec3 ac = mesh.vertices[mesh.indices[i + 2U]] - mesh.vertices[mesh.indices[i]];
        const glm::vec3 cross{ab.y * ac.z - ab.z * ac.y, ab.z * ac.x - ab.x * ac.z, ab.x * ac.y - ab.y * ac.x};
        if (cross.x * cross.x + cross.y * cross.y + cross.z * cross.z <= 1.0e-12F) throw MapLoadError("M3CL contains a degenerate triangle");
    }
    return mesh;
}

MapManifest MapPackageLoader::parseManifest(const std::string& jsonText) {
    nlohmann::json root;
    try { root = nlohmann::json::parse(jsonText); }
    catch (const nlohmann::json::exception& error) { throw MapLoadError(std::string("invalid map manifest JSON: ") + error.what()); }
    if (!root.is_object() || root.value("format", "") != "cpp-server-map") throw MapLoadError("unsupported map manifest format");
    if (!root.contains("formatVersion") || !root.at("formatVersion").is_number_unsigned()) throw MapLoadError("manifest formatVersion must be an unsigned integer");
    const std::uint32_t version = root.at("formatVersion").get<std::uint32_t>();
    if (version != kManifestVersion) throw MapLoadError("unsupported map manifest major version");
    exactKeys(root, {"format", "formatVersion", "mapId", "contentHash", "coordinateSystem", "worldBounds", "assets", "assetHashes", "environment", "policy"}, "manifest");
    const auto& coordinates = root.at("coordinateSystem"); exactKeys(coordinates, {"handedness", "upAxis", "units"}, "coordinateSystem");
    if (coordinates.value("handedness", "") != "right" || coordinates.value("upAxis", "") != "Y" ||
        coordinates.value("units", "") != "meters") throw MapLoadError("map coordinate system must be right-handed, Y-up, meters");
    MapManifest manifest;
    manifest.formatVersion = version;
    if (!root.at("mapId").is_string() || !root.at("contentHash").is_string()) throw MapLoadError("manifest id and hash must be strings");
    manifest.mapId = root.at("mapId").get<std::string>(); manifest.contentHash = root.at("contentHash").get<std::string>();
    if (!validId(manifest.mapId) || !validHash(manifest.contentHash)) throw MapLoadError("manifest id or hash is invalid");
    const auto& worldBounds = root.at("worldBounds"); exactKeys(worldBounds, {"min", "max"}, "worldBounds");
    manifest.boundsMin = jsonVec3(worldBounds.at("min"), "worldBounds.min"); manifest.boundsMax = jsonVec3(worldBounds.at("max"), "worldBounds.max");
    if (manifest.boundsMin.x > manifest.boundsMax.x || manifest.boundsMin.y > manifest.boundsMax.y || manifest.boundsMin.z > manifest.boundsMax.z) throw MapLoadError("manifest world bounds are inverted");
    const auto& assets = root.at("assets"); exactKeys(assets, {"render", "collision", "gameplay", "navigation", "radar", "debug"}, "assets");
    manifest.renderAsset = assets.at("render").get<std::string>(); manifest.collisionAsset = assets.at("collision").get<std::string>(); manifest.gameplayAsset = assets.at("gameplay").get<std::string>(); manifest.debugAsset = assets.at("debug").get<std::string>();
    if (!assets.at("navigation").is_null()) manifest.navigationAsset = assets.at("navigation").get<std::string>();
    if (!assets.at("radar").is_null()) manifest.radarAsset = assets.at("radar").get<std::string>();
    for (const auto& path : {manifest.renderAsset, manifest.collisionAsset, manifest.gameplayAsset, manifest.debugAsset}) if (!validAsset(path)) throw MapLoadError("manifest asset path is invalid");
    if ((!manifest.navigationAsset.empty() && !validAsset(manifest.navigationAsset)) || (!manifest.radarAsset.empty() && !validAsset(manifest.radarAsset))) throw MapLoadError("optional asset path is invalid");
    const auto& hashes = root.at("assetHashes"); if (!hashes.is_object() || hashes.empty()) throw MapLoadError("assetHashes must be an object");
    std::set<std::string> declared{manifest.renderAsset, manifest.collisionAsset, manifest.gameplayAsset, manifest.debugAsset}; if (!manifest.navigationAsset.empty()) declared.insert(manifest.navigationAsset); if (!manifest.radarAsset.empty()) declared.insert(manifest.radarAsset);
    for (const auto& [path, hash] : hashes.items()) { if (declared.erase(path) == 0U || !hash.is_string() || !validHash(hash.get<std::string>())) throw MapLoadError("assetHashes contains an invalid entry"); manifest.assetHashes.emplace_back(path, hash.get<std::string>()); }
    if (!declared.empty()) throw MapLoadError("assetHashes does not cover every asset");
    const auto& environment = root.at("environment"); exactKeys(environment, {"clearColor", "exposure", "sunDirection", "shadowDistance"}, "environment"); manifest.clearColor = jsonVec3(environment.at("clearColor"), "environment.clearColor"); if (manifest.clearColor.x < 0 || manifest.clearColor.y < 0 || manifest.clearColor.z < 0 || manifest.clearColor.x > 1 || manifest.clearColor.y > 1 || manifest.clearColor.z > 1) throw MapLoadError("clearColor is outside [0,1]"); manifest.exposure = ranged(environment.at("exposure"), "environment.exposure", 0.0001F, 8.0F); manifest.sunDirection = jsonVec3(environment.at("sunDirection"), "environment.sunDirection"); manifest.shadowDistance = ranged(environment.at("shadowDistance"), "environment.shadowDistance", 0.0F, 1000.0F);
    const auto& policy = root.at("policy"); exactKeys(policy, {"stepSmoothingMax", "audioDistanceScale", "radarNorthYaw"}, "policy"); manifest.stepSmoothingMax = ranged(policy.at("stepSmoothingMax"), "policy.stepSmoothingMax", 0.0F, 2.0F); manifest.audioDistanceScale = ranged(policy.at("audioDistanceScale"), "policy.audioDistanceScale", 0.0001F, 100.0F); manifest.radarNorthYaw = ranged(policy.at("radarNorthYaw"), "policy.radarNorthYaw", -6.283186F, 6.283186F);
    return manifest;
}

MapPackage MapPackageLoader::load(const std::filesystem::path& directory) {
    const auto manifestText = readText(directory / "manifest.json");
    MapPackage package{directory, parseManifest(manifestText), {}};
    const auto collisionBytes = readBytes(directory / package.manifest.collisionAsset);
    package.collision = parseCollision(collisionBytes);
    if (package.collision.boundsMin != package.manifest.boundsMin || package.collision.boundsMax != package.manifest.boundsMax) throw MapLoadError("collision and manifest bounds differ");

    auto json = nlohmann::json::parse(manifestText); json.erase("contentHash"); const std::string canonical = json.dump();
    util::Sha256 hash;
    hash.update(reinterpret_cast<const std::uint8_t*>(canonical.data()), canonical.size());
    std::sort(package.manifest.assetHashes.begin(), package.manifest.assetHashes.end());
    for (const auto& [path, expectedHash] : package.manifest.assetHashes) { const auto bytes = readBytes(directory / path); util::Sha256 assetHash; assetHash.update(bytes.data(), bytes.size()); if ("sha256:" + assetHash.finishHex() != expectedHash) throw MapLoadError("map asset hash mismatch: " + path); hash.update(bytes.data(), bytes.size()); }
    const auto gameplay = nlohmann::json::parse(readText(directory / package.manifest.gameplayAsset)); parseGameplayV2(package.manifest, gameplay);
    if (!package.manifest.navigationAsset.empty()) validateNavigationV2(nlohmann::json::parse(readText(directory / package.manifest.navigationAsset)), package.manifest);
    if ("sha256:" + hash.finishHex() != package.manifest.contentHash) throw MapLoadError("map package content hash mismatch");
    return package;
}
