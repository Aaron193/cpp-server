#include "TestHarness.hpp"

#include <cmath>
#include <filesystem>
#include <fstream>
#include <nlohmann/json.hpp>
#include <unordered_set>
#include <vector>

#include "maps/MapPackage.hpp"
#include "physics/PhysicsWorld.hpp"

namespace {
std::filesystem::path repositoryRoot() {
    return std::filesystem::path(SERVER_SOURCE_DIR).parent_path();
}

glm::vec3 vec3(const nlohmann::json& value) {
    return {value.at(0).get<float>(), value.at(1).get<float>(),
            value.at(2).get<float>()};
}
}  // namespace

TEST_CASE(shared_movement_command_trace_runs_through_native_adapter) {
  for (const char* fixtureName : {"phase0-command-trace.json",
                                  "phase7-copper-command-trace.json"}) {
    std::ifstream input(repositoryRoot() / "fixtures/movement" / fixtureName);
    EXPECT_TRUE(input.is_open());
    nlohmann::json fixture;
    input >> fixture;
    EXPECT_EQ(fixture.at("format").get<std::string>(),
              "cpp-server-movement-trace");
    EXPECT_EQ(fixture.at("formatVersion").get<int>(), 1);

    const auto package = MapPackageLoader::load(
        repositoryRoot() / "client/public/maps" /
        fixture.at("map").at("mapId").get<std::string>());
    EXPECT_EQ(package.manifest.contentHash,
              fixture.at("map").at("contentHash").get<std::string>());

    const auto& tuning = fixture.at("tuning");
    PhysicsWorld::CharacterConfig config;
    config.radius = tuning.at("capsuleRadius").get<float>();
    config.halfHeight = tuning.at("capsuleHalfHeight").get<float>();
    config.maxSlopeRadians = tuning.at("maxSlopeRadians").get<float>();
    config.stepHeight = tuning.at("stepUpHeight").get<float>();
    config.stickToFloorDistance =
        tuning.at("stickToFloorDistance").get<float>();
    config.groundAcceleration = tuning.at("groundAcceleration").get<float>();
    config.airAcceleration = tuning.at("airAcceleration").get<float>();
    config.airControl = tuning.at("airControl").get<float>();
    config.jumpSpeed = tuning.at("jumpSpeed").get<float>();
    config.gravity = tuning.at("gravity").get<float>();
    config.terminalVelocity = tuning.at("terminalVelocity").get<float>();

    PhysicsWorld world;
    world.addStaticCollision(package.collision);
    const auto character = world.createCharacter(config, vec3(fixture.at("spawn")));
    std::unordered_set<std::uint32_t> checkpointTicks;
    for (const auto& value : fixture.at("checkpointTicks"))
        checkpointTicks.insert(value.get<std::uint32_t>());
    std::unordered_set<std::uint32_t> replayResetTicks;
    for (const auto& value : fixture.at("replayResetTicks"))
        replayResetTicks.insert(value.get<std::uint32_t>());
    const auto& references = fixture.at("referenceCheckpoints");
    const auto& tolerance = fixture.at("comparisonTolerance");
    struct AppliedCommand { glm::vec3 desired; bool jump = false; };
    std::vector<AppliedCommand> applied;
    std::vector<PhysicsWorld::CharacterState> states;
    states.push_back(world.characterState(character));

    std::uint32_t tick = 0U;
    std::size_t visited = 0U;
    const float speed = tuning.at("groundSpeed").get<float>();
    const float delta = fixture.at("fixedDeltaSeconds").get<float>();
    for (const auto& segment : fixture.at("segments")) {
        std::unordered_set<int> jumpTicks;
        for (const auto& value : segment.at("jumpAt"))
            jumpTicks.insert(value.get<int>());
        const float forward = segment.at("forward").get<float>();
        const float right = segment.at("right").get<float>();
        const float yaw = segment.at("yaw").get<float>();
        const float length = std::hypot(forward, right);
        const float scale = length > 1.0F ? 1.0F / length : 1.0F;
        const float normalizedForward = forward * scale;
        const float normalizedRight = right * scale;
        const glm::vec3 desired{
            (std::sin(yaw) * normalizedForward +
             std::cos(yaw) * normalizedRight) * speed,
            0.0F,
            (-std::cos(yaw) * normalizedForward +
             std::sin(yaw) * normalizedRight) * speed};
        const int ticks = segment.at("ticks").get<int>();
        for (int segmentTick = 0; segmentTick < ticks; ++segmentTick) {
            world.updateCharacter(character, delta, desired,
                                  jumpTicks.count(segmentTick) != 0U);
            applied.push_back({desired, jumpTicks.count(segmentTick) != 0U});
            world.step(delta);
            ++tick;
            states.push_back(world.characterState(character));
            if (replayResetTicks.count(tick) != 0U) {
                const auto resetTick = tick - 30U;
                const auto expected = states.at(tick);
                world.setCharacterPosition(character,
                                           states.at(resetTick).position);
                world.setCharacterVelocity(character,
                                           states.at(resetTick).velocity);
                for (std::uint32_t replay = resetTick; replay < tick;
                     ++replay) {
                    world.updateCharacter(character, delta,
                        applied.at(replay).desired, applied.at(replay).jump);
                    world.step(delta);
                }
                const auto replayed = world.characterState(character);
                EXPECT_NEAR(replayed.position.x, expected.position.x,
                            tolerance.at("positionMeters").get<float>());
                EXPECT_NEAR(replayed.position.y, expected.position.y,
                            tolerance.at("positionMeters").get<float>());
                EXPECT_NEAR(replayed.position.z, expected.position.z,
                            tolerance.at("positionMeters").get<float>());
                EXPECT_NEAR(replayed.velocity.x, expected.velocity.x,
                            tolerance.at("velocityMetersPerSecond").get<float>());
                EXPECT_NEAR(replayed.velocity.y, expected.velocity.y,
                            tolerance.at("velocityMetersPerSecond").get<float>());
                EXPECT_NEAR(replayed.velocity.z, expected.velocity.z,
                            tolerance.at("velocityMetersPerSecond").get<float>());
                states.at(tick) = replayed;
            }
            if (checkpointTicks.count(tick) == 0U) continue;
            const auto state = world.characterState(character);
            EXPECT_TRUE(std::isfinite(state.position.x));
            EXPECT_TRUE(std::isfinite(state.position.y));
            EXPECT_TRUE(std::isfinite(state.position.z));
            EXPECT_TRUE(std::isfinite(state.velocity.x));
            EXPECT_TRUE(std::isfinite(state.velocity.y));
            EXPECT_TRUE(std::isfinite(state.velocity.z));
            EXPECT_TRUE(state.position.x >= package.manifest.boundsMin.x &&
                        state.position.x <= package.manifest.boundsMax.x);
            EXPECT_TRUE(state.position.z >= package.manifest.boundsMin.z &&
                        state.position.z <= package.manifest.boundsMax.z);
            const auto& reference = references.at(visited);
            EXPECT_EQ(reference.at("tick").get<std::uint32_t>(), tick);
            const auto expectedPosition = vec3(reference.at("position"));
            const auto expectedVelocity = vec3(reference.at("velocity"));
            const float positionTolerance =
                tolerance.at("positionMeters").get<float>();
            const float velocityTolerance =
                tolerance.at("velocityMetersPerSecond").get<float>();
            EXPECT_NEAR(state.position.x, expectedPosition.x, positionTolerance);
            EXPECT_NEAR(state.position.y, expectedPosition.y, positionTolerance);
            EXPECT_NEAR(state.position.z, expectedPosition.z, positionTolerance);
            EXPECT_NEAR(state.velocity.x, expectedVelocity.x, velocityTolerance);
            EXPECT_NEAR(state.velocity.y, expectedVelocity.y, velocityTolerance);
            EXPECT_NEAR(state.velocity.z, expectedVelocity.z, velocityTolerance);
            if (tolerance.at("groundedMustMatch").get<bool>())
                EXPECT_EQ(state.grounded,
                          reference.at("grounded").get<bool>());
            ++visited;
        }
    }
    EXPECT_EQ(visited, checkpointTicks.size());
  }
}
