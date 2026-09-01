#include <fstream>
#include <string>

#include <nlohmann/json.hpp>

#include "GameConfig.hpp"
#include "TestHarness.hpp"
#include "combat/Aiming.hpp"

TEST_CASE(shared_aiming_trace_matches_typescript_within_one_e_minus_five) {
    std::ifstream input(std::string(SERVER_SOURCE_DIR) +
                        "/../fixtures/aiming/trace.json");
    nlohmann::json fixture;
    input >> fixture;
    const auto config = GameConfig::loadFromFile(
        std::string(SERVER_SOURCE_DIR) + "/game_config.json");
    Aiming::State state{};
    state.weapon = protocol::Weapon::Rifle;
    const auto& profile = config.rifle.aim;
    const auto& steps = fixture.at("steps");
    const auto& expected = fixture.at("expected");
    for (std::size_t index = 0; index < steps.size(); ++index) {
        const auto& step = steps.at(index);
        Aiming::step(state, profile, step.at("intent").get<bool>(),
                     step.at("eligible").get<bool>(),
                     step.at("speedRatio").get<float>(),
                     step.at("grounded").get<bool>(),
                     static_cast<protocol::Stance>(step.at("stance").get<int>()),
                     step.at("dt").get<float>());
        if (step.at("shot").get<bool>())
            Aiming::acceptedShot(state, profile, config.combat.serverSeed,
                                 fixture.at("player").get<std::uint32_t>());
        const auto& value = expected.at(index);
        EXPECT_NEAR(state.aimProgress, value.at("aimProgress").get<float>(), 0.00001F);
        EXPECT_NEAR(state.bloomRadians, value.at("bloomRadians").get<float>(), 0.00001F);
        EXPECT_NEAR(state.spreadRadians, value.at("spreadRadians").get<float>(), 0.00001F);
        EXPECT_NEAR(state.recoilPitch, value.at("recoilPitch").get<float>(), 0.00001F);
        EXPECT_NEAR(state.recoilYaw, value.at("recoilYaw").get<float>(), 0.00001F);
        EXPECT_EQ(state.recoilSequence, value.at("recoilSequence").get<std::uint32_t>());
        EXPECT_EQ(state.patternIndex, value.at("patternIndex").get<std::uint32_t>());
    }
}

TEST_CASE(aiming_spread_is_partial_and_accepted_shots_alone_advance_recoil) {
    const auto config = GameConfig::loadFromFile(
        std::string(SERVER_SOURCE_DIR) + "/game_config.json");
    Aiming::State state{};
    const auto& profile = config.rifle.aim;
    Aiming::step(state, profile, true, true, 0.0F, true,
                 protocol::Stance::Standing, profile.aimInSeconds * 0.5F);
    EXPECT_NEAR(state.aimProgress, 0.5F, 0.00001F);
    EXPECT_TRUE(state.spreadRadians > profile.adsSpreadRadians);
    EXPECT_EQ(state.recoilSequence, 0U);
    Aiming::acceptedShot(state, profile, config.combat.serverSeed, 1U);
    EXPECT_EQ(state.recoilSequence, 1U);
    EXPECT_NEAR(state.bloomRadians, profile.bloomPerShotRadians, 0.00001F);
}
