#pragma once
#include <algorithm>
#include <array>
#include <cstdint>
#include <string_view>
#include <vector>

#include "maps/MapPackage.hpp"

/** Fixed-tick, server-owned capture model. Neutralize before capturing; mixed
 * presence freezes. */
namespace Conquest {
struct Objective {
    MapZone zone;
    std::uint8_t owner = 0;
    std::uint8_t capturing = 0;
    float progress = 0;
    bool contested = false;
};
inline std::string objectiveId(const MapZone& zone) {
    constexpr std::string_view suffix = "-capture";
    const auto& id = zone.id;
    return id.size() >= suffix.size() && id.compare(id.size() - suffix.size(),
                                                    suffix.size(), suffix) == 0
               ? id.substr(0, id.size() - suffix.size())
               : id;
}
inline std::string deploymentSector(const MapSpawnPoint& spawn) {
    if (spawn.team == "west" || spawn.team == "east") return "hq/" + spawn.team;
    const auto suffix = spawn.id.rfind("-spawn-");
    return suffix == std::string::npos ? spawn.id : spawn.id.substr(0, suffix);
}
struct Player {
    glm::vec3 position;
    std::uint8_t team;
    bool active;
};
class Rules {
   public:
    static constexpr float captureSeconds = 12;
    static constexpr std::uint16_t startingTickets = 500;
    std::vector<Objective> objectives;
    std::array<float, 2> tickets{startingTickets, startingTickets};
    void reset() {
        tickets = {startingTickets, startingTickets};
        for (auto& o : objectives) {
            o.owner = 0;
            o.capturing = 0;
            o.progress = 0;
            o.contested = false;
        }
    }
    void death(std::uint8_t team) {
        if (team >= 1 && team <= 2)
            tickets[team - 1] = std::max(0.F, tickets[team - 1] - 1);
    }
    void step(const std::vector<Player>& players, float dt) {
        std::array<int, 2> held{};
        for (auto& o : objectives) {
            std::array<int, 2> count{};
            for (const auto& p : players)
                if (p.active && p.team >= 1 && p.team <= 2 &&
                    p.position.x >= o.zone.min.x &&
                    p.position.x <= o.zone.max.x &&
                    p.position.y >= o.zone.min.y &&
                    p.position.y <= o.zone.max.y &&
                    p.position.z >= o.zone.min.z &&
                    p.position.z <= o.zone.max.z)
                    ++count[p.team - 1];
            o.contested = count[0] > 0 && count[1] > 0;
            const std::uint8_t team = count[0] > 0 ? 1 : count[1] > 0 ? 2 : 0;
            if (!o.contested) {
                if (team == 0 || team == o.owner) {
                    o.progress =
                        std::max(0.F, o.progress - dt / captureSeconds);
                    if (o.progress == 0) o.capturing = 0;
                } else {
                    if (o.capturing != 0 && o.capturing != team) {
                        o.progress =
                            std::max(0.F, o.progress - dt / captureSeconds);
                        if (o.progress == 0) o.capturing = team;
                    } else {
                        o.capturing = team;
                        o.progress +=
                            dt / captureSeconds * std::min(3, count[team - 1]);
                    }
                    if (o.progress >= 1) {
                        o.owner = o.owner == 0 ? team : 0;
                        o.progress = 0;
                        o.capturing = 0;
                    }
                }
            }
            if (o.owner) ++held[o.owner - 1];
        }
        // A strict majority drains the opposing reserve, at 1 ticket/s per
        // excess flag.
        const int majority = static_cast<int>(objectives.size() / 2) + 1;
        for (int t = 0; t < 2; t++)
            if (held[t] >= majority)
                tickets[1 - t] = std::max(
                    0.F, tickets[1 - t] - dt * (held[t] - majority + 1));
    }
    bool ended() const { return tickets[0] <= 0 || tickets[1] <= 0; }
};
}  // namespace Conquest
