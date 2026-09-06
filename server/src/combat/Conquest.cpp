#include <algorithm>
#include <cmath>

#include "GameServer.hpp"
#include "client/Client.hpp"
#include "ecs/components.hpp"

std::uint8_t GameServer::playerTeam(entt::entity player) const {
    const auto& r = m_entityManager.getRegistry();
    if (!r.valid(player)) return 0;
    const auto* t = r.try_get<Components::Team>(player);
    return t ? t->value : 0;
}
std::uint8_t GameServer::assignTeam() const {
    std::array<int, 2> counts{};
    const auto& r = m_entityManager.getRegistry();
    for (auto p : r.view<Components::Team>()) {
        auto t = r.get<Components::Team>(p).value;
        if (t >= 1 && t <= 2) ++counts[t - 1];
    }
    return counts[0] <= counts[1] ? 1 : 2;
}
bool GameServer::canDeployAt(entt::entity player,
                             const MapSpawnPoint& spawn) const {
    const auto team = playerTeam(player);
    if (!isConquest() || team < 1 || team > 2 ||
        std::find(spawn.modes.begin(), spawn.modes.end(), "conquest") ==
            spawn.modes.end())
        return false;
    if (spawn.team == (team == 1 ? "west" : "east")) return true;
    for (const auto& o : conquest_.objectives)
        if (o.owner == team && !o.contested &&
            (o.capturing == 0 || o.capturing == team) &&
            spawn.id.rfind(Conquest::objectiveId(o.zone) + "-spawn-", 0) == 0)
            return true;
    return false;
}
void GameServer::requestDeploy(entt::entity player,
                               const protocol::Deploy& request) {
    auto& r = m_entityManager.getRegistry();
    if (!isConquest() || !r.valid(player) ||
        !r.all_of<Components::Team, Components::PlayerLife>(player) ||
        !r.get<Components::PlayerLife>(player).dead)
        return;
    if (request.weapon != protocol::Weapon::Rifle &&
        request.weapon != protocol::Weapon::Shotgun)
        return;
    auto& t = r.get<Components::Team>(player);
    t.deployRequested = false;
    const auto& spawns = m_mapPackage.manifest.spawnPoints;
    const auto requested = std::find_if(
        spawns.begin(), spawns.end(),
        [&](const auto& spawn) { return spawn.id == request.spawnId; });
    if (requested == spawns.end() || !canDeployAt(player, *requested)) return;
    t.selectedSpawn = request.spawnId;
    t.weapon = request.weapon;
    t.deployRequested = true;
}
protocol::ConquestState GameServer::conquestState(
    entt::entity recipient) const {
    protocol::ConquestState state{};
    state.serverTick = static_cast<std::uint32_t>(m_currentTick);
    state.westTickets =
        static_cast<std::uint16_t>(std::ceil(conquest_.tickets[0]));
    state.eastTickets =
        static_cast<std::uint16_t>(std::ceil(conquest_.tickets[1]));
    state.localTeam = playerTeam(recipient);
    const auto& r = m_entityManager.getRegistry();
    const auto* life = r.try_get<Components::PlayerLife>(recipient);
    state.deployReady = life && life->dead && life->respawnRemaining <= 0 &&
                        matchPhase_ == protocol::MatchPhase::Active;
    for (const auto& o : conquest_.objectives)
        state.objectives.push_back({Conquest::objectiveId(o.zone), o.owner,
                                    o.capturing, o.progress, o.contested});
    for (auto p : r.view<Components::Team>())
        state.roster.push_back({static_cast<std::uint32_t>(p), playerTeam(p)});
    std::sort(
        state.roster.begin(), state.roster.end(),
        [](const auto& a, const auto& b) { return a.playerId < b.playerId; });
    return state;
}
void GameServer::updateConquest(float delta) {
    if (!isConquest()) return;
    if (matchPhase_ == protocol::MatchPhase::Active) {
        std::vector<Conquest::Player> players;
        auto& r = m_entityManager.getRegistry();
        for (auto p : r.view<Components::Transform3D, Components::PlayerLife,
                             Components::Team>())
            players.push_back({r.get<Components::Transform3D>(p).position,
                               playerTeam(p),
                               !r.get<Components::PlayerLife>(p).dead});
        conquest_.step(players, delta);
        if (conquest_.ended()) transitionToIntermission();
    }
    if (m_currentTick % 12 == 0)
        for (const auto& entry : m_clients)
            if (entry.second && entry.second->welcomed())
                entry.second->queueConquestState(
                    conquestState(entry.second->m_entity));
}
