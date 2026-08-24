#include "TestHarness.hpp"

#include <optional>
#include <string>
#include <variant>
#include <vector>

#include "GameConfig.hpp"
#include "GameServer.hpp"

namespace {

std::string defaultConfigPath() {
    return std::string(SERVER_SOURCE_DIR) + "/game_config.json";
}

std::string fastConfigPath() {
    return std::string(SERVER_SOURCE_DIR) +
           "/tests/fixtures/fast_live_combat_game_config.json";
}

}  // namespace

TEST_CASE(game_config_path_resolution_preserves_default_and_accepts_override) {
    EXPECT_EQ(GameServer::resolveGameConfigPath(nullptr), defaultConfigPath());
    EXPECT_EQ(GameServer::resolveGameConfigPath(""), defaultConfigPath());
    EXPECT_EQ(GameServer::resolveGameConfigPath(fastConfigPath().c_str()),
              fastConfigPath());
}

TEST_CASE(explicit_game_config_path_loads_validated_fast_live_fixture) {
    // Constructor injection exercises the same load path as GAME_CONFIG_PATH
    // without changing process-wide environment state for parallel tests.
    GameServer server(fastConfigPath());

    EXPECT_NEAR(server.m_gameConfig.movement.capsuleRadius, 0.42F, 0.0001F);
    EXPECT_NEAR(server.m_gameConfig.movement.eyeHeight, 1.62F, 0.0001F);
    EXPECT_NEAR(server.m_gameConfig.rifle.damage, 100.0F, 0.0001F);
    EXPECT_NEAR(server.m_gameConfig.rifle.spread, 0.0F, 0.0001F);
    EXPECT_EQ(server.m_gameConfig.combat.scoreLimit, 1U);
    EXPECT_NEAR(server.m_gameConfig.combat.roundSeconds, 5.0F, 0.0001F);
    EXPECT_NEAR(server.m_gameConfig.combat.intermissionSeconds, 1.5F,
                0.0001F);
    EXPECT_NEAR(server.m_gameConfig.combat.respawnSeconds, 0.25F, 0.0001F);
    EXPECT_TRUE(server.m_gameConfig.combat.respawnSeconds <
                server.m_gameConfig.combat.intermissionSeconds);

    const auto production = GameConfig::loadFromFile(defaultConfigPath());
    EXPECT_EQ(production.combat.scoreLimit, 25U);
    EXPECT_NEAR(production.combat.intermissionSeconds, 10.0F, 0.0001F);
}

TEST_CASE(fast_live_fixture_exercises_combat_respawn_and_round_lifecycle) {
    enum class ObservedEvent {
        Damage,
        Death,
        Ended,
        Intermission,
        Respawn,
        Reset,
        Started,
    };

    GameServer server(fastConfigPath());
    const auto killer = server.m_entityManager.createPlayer();
    const auto victim = server.m_entityManager.createPlayer();
    std::vector<ObservedEvent> observed;
    server.setReliableEventHook(
        [&](std::optional<entt::entity> recipient,
            const ReliableGameEvent& event) {
            if (std::holds_alternative<protocol::Damage>(event) &&
                recipient == victim)
                observed.push_back(ObservedEvent::Damage);
            else if (std::holds_alternative<protocol::Death>(event))
                observed.push_back(ObservedEvent::Death);
            else if (std::holds_alternative<protocol::Respawn>(event))
                observed.push_back(ObservedEvent::Respawn);
            else if (const auto* transition =
                         std::get_if<protocol::RoundTransition>(&event)) {
                switch (transition->transition) {
                    case protocol::RoundTransitionKind::Ended:
                        observed.push_back(ObservedEvent::Ended);
                        break;
                    case protocol::RoundTransitionKind::Intermission:
                        observed.push_back(ObservedEvent::Intermission);
                        break;
                    case protocol::RoundTransitionKind::Reset:
                        observed.push_back(ObservedEvent::Reset);
                        break;
                    case protocol::RoundTransitionKind::Started:
                        observed.push_back(ObservedEvent::Started);
                        break;
                }
            }
        });

    EXPECT_TRUE(server.applyDamage(killer, victim,
                                   server.m_gameConfig.rifle.damage,
                                   ItemType::GUN_RIFLE));
    server.simulateOneTick();
    EXPECT_EQ(server.matchState().phase, protocol::MatchPhase::Intermission);
    const auto resetTick =
        static_cast<std::uint64_t>(server.matchState().phaseEndsAtTick);
    while (server.m_currentTick < resetTick) server.simulateOneTick();

    const std::vector<ObservedEvent> expected{
        ObservedEvent::Damage, ObservedEvent::Death, ObservedEvent::Ended,
        ObservedEvent::Intermission, ObservedEvent::Respawn,
        ObservedEvent::Reset, ObservedEvent::Started};
    EXPECT_EQ(observed, expected);
    EXPECT_EQ(server.matchState().phase, protocol::MatchPhase::Active);
    EXPECT_EQ(server.matchState().roundNumber, 2U);
}
