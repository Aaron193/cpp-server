#include "TestHarness.hpp"

#include <cstring>
#include <filesystem>
#include <fstream>
#include <algorithm>
#include <nlohmann/json.hpp>

#include "GameConfig.hpp"
#include "maps/MapPackage.hpp"
#include "util/Sha256.hpp"

namespace {
void appendU16(std::vector<std::uint8_t>& bytes, std::uint16_t value) {
    bytes.push_back(value & 0xffU); bytes.push_back(value >> 8U);
}
void appendU32(std::vector<std::uint8_t>& bytes, std::uint32_t value) {
    for (int i = 0; i < 4; ++i) bytes.push_back((value >> (i * 8)) & 0xffU);
}
void appendFloat(std::vector<std::uint8_t>& bytes, float value) {
    std::uint32_t bits; std::memcpy(&bits, &value, sizeof(bits)); appendU32(bytes, bits);
}
std::vector<std::uint8_t> triangle() {
    std::vector<std::uint8_t> result{'M','3','C','L'};
    appendU16(result, 1); appendU16(result, 0); appendU32(result, 3); appendU32(result, 3);
    for (float value : {0.0F,0.0F,0.0F, 1.0F,1.0F,1.0F}) appendFloat(result, value);
    for (float value : {0.0F,0.0F,0.0F, 1.0F,0.0F,0.0F, 0.0F,0.0F,1.0F}) appendFloat(result, value);
    appendU32(result, 0); appendU32(result, 1); appendU32(result, 2);
    return result;
}
template <typename Function> bool throwsMapError(Function&& function) {
    try { function(); } catch (const MapLoadError&) { return true; }
    return false;
}
std::filesystem::path committedMap() {
    return std::filesystem::path(SERVER_SOURCE_DIR).parent_path() /
           "client/public/maps/graybox-arena";
}
}  // namespace

TEST_CASE(m3cl_parser_accepts_valid_little_endian_triangle) {
    const auto mesh = MapPackageLoader::parseCollision(triangle());
    EXPECT_EQ(mesh.vertices.size(), 3U);
    EXPECT_EQ(mesh.indices.size(), 3U);
}

TEST_CASE(m3cl_parser_rejects_malformed_truncated_and_versioned_inputs) {
    auto malformed = triangle(); malformed[0] = 'X';
    EXPECT_TRUE(throwsMapError([&] { MapPackageLoader::parseCollision(malformed); }));
    auto truncated = triangle(); truncated.pop_back();
    EXPECT_TRUE(throwsMapError([&] { MapPackageLoader::parseCollision(truncated); }));
    auto version = triangle(); version[4] = 2;
    EXPECT_TRUE(throwsMapError([&] { MapPackageLoader::parseCollision(version); }));
}

TEST_CASE(m3cl_parser_rejects_incomplete_and_out_of_range_indices) {
    auto incomplete = triangle(); incomplete[12] = 2;
    EXPECT_TRUE(throwsMapError([&] { MapPackageLoader::parseCollision(incomplete); }));
    auto invalid = triangle(); invalid[invalid.size() - 4] = 3;
    EXPECT_TRUE(throwsMapError([&] { MapPackageLoader::parseCollision(invalid); }));
}

TEST_CASE(committed_manifest_spawns_hash_and_bounds_validate) {
    const auto package = MapPackageLoader::load(committedMap());
    EXPECT_EQ(package.manifest.mapId, "graybox-arena");
    EXPECT_TRUE(package.manifest.spawnPoints.size() >= 12U);
    EXPECT_EQ(package.manifest.contentHash,
              "sha256:9185ea6742b55dee10cd168f24b0b866f0decafe747abbec932dc983c36eae64");
    EXPECT_EQ(package.manifest.boundsMin, package.collision.boundsMin);
    EXPECT_EQ(package.manifest.boundsMax, package.collision.boundsMax);
}

TEST_CASE(configuration_sha256_is_stable_formatted_and_change_sensitive) {
    const auto config = GameConfig::loadFromFile(
        std::string(SERVER_SOURCE_DIR) + "/game_config.json");
    const std::string canonical = config.toJsonString();
    const std::string hash = util::sha256Identifier(canonical);

    EXPECT_EQ(util::sha256Hex("abc"),
              "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    EXPECT_EQ(hash.size(), 71U);
    EXPECT_EQ(hash.substr(0U, 7U), std::string("sha256:"));
    EXPECT_TRUE(std::all_of(hash.begin() + 7, hash.end(), [](char value) {
        return (value >= '0' && value <= '9') ||
               (value >= 'a' && value <= 'f');
    }));
    EXPECT_EQ(hash, util::sha256Identifier(config.toJsonString()));
    EXPECT_TRUE(hash != util::sha256Identifier(canonical + " "));
}

TEST_CASE(manifest_rejects_coordinate_and_spawn_bounds_mismatches) {
    std::ifstream input(committedMap() / "manifest.json");
    nlohmann::json json; input >> json;
    json["coordinateSystem"]["upAxis"] = "Z";
    EXPECT_TRUE(throwsMapError([&] { MapPackageLoader::parseManifest(json.dump()); }));
    json["coordinateSystem"]["upAxis"] = "Y";
    json["spawnPoints"][0]["position"][0] = 10000.0;
    EXPECT_TRUE(throwsMapError([&] { MapPackageLoader::parseManifest(json.dump()); }));
}
