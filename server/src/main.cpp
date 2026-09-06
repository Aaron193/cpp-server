#include <uwebsockets/App.h>

#include <cstdlib>
#include <iostream>

#include "GameServer.hpp"
#include "ServerRegistration.hpp"
#include "SocketServer.hpp"
#include "security/JoinTicketValidator.hpp"

// Helper function to get environment variable with default value
std::string getEnvVar(const char* name, const std::string& defaultValue = "") {
    const char* value = std::getenv(name);
    return value ? std::string(value) : defaultValue;
}

int main() {
    std::cout << "Game has Started!" << std::endl;

    // Read configuration from environment variables
    std::string serverId = getEnvVar("SERVER_ID", "server-1");
    std::string serverHost = getEnvVar("SERVER_HOST", "localhost");
    int serverPort = std::stoi(getEnvVar("SERVER_PORT", "9001"));
    std::string serverRegion = getEnvVar("SERVER_REGION", "local");
    int maxPlayers = std::stoi(getEnvVar("MAX_PLAYERS", "12"));
    std::string webApiUrl = getEnvVar("WEB_API_URL", "localhost:3000");
    std::string sharedSecret = getEnvVar("SERVER_SHARED_SECRET", "");
    std::string buildId = getEnvVar("SERVER_BUILD_ID", "dev");
    if (maxPlayers < 2 || maxPlayers > 128)
        throw std::runtime_error("MAX_PLAYERS must be between 2 and 128");
    std::string mode = getEnvVar("SERVER_MODE", "conquest");
    std::string websocketUrl =
        getEnvVar("SERVER_WEBSOCKET_URL",
                  "ws://" + serverHost + ":" + std::to_string(serverPort));
    std::string joinTicketSecret = getEnvVar("JOIN_TICKET_SECRET", "");
    std::string joinTicketAudience =
        getEnvVar("JOIN_TICKET_AUDIENCE", "arena-game-server");

    std::cout << "[Config] Server ID: " << serverId << std::endl;
    std::cout << "[Config] Host: " << serverHost << ":" << serverPort
              << std::endl;
    std::cout << "[Config] Region: " << serverRegion << std::endl;
    std::cout << "[Config] Max Players: " << maxPlayers << std::endl;
    std::cout << "[Config] Web API: " << webApiUrl << std::endl;
    std::cout << "[Config] Shared Secret: "
              << (sharedSecret.empty() ? "<not set>" : "<set>") << std::endl;

    if (mode == "conquest" && !std::getenv("GAME_CONFIG_PATH"))
        setenv(
            "GAME_CONFIG_PATH",
            (std::filesystem::path(GameServer::resolveGameConfigPath(nullptr))
                 .parent_path() /
             "infantry_config.json")
                .c_str(),
            0);
    if (mode == "conquest" && !std::getenv("MAP_PACKAGE_DIR") &&
        !std::getenv("MAP_PACKAGE_ROOT"))
        setenv(
            "MAP_PACKAGE_DIR",
            (std::filesystem::path(GameServer::resolveGameConfigPath(nullptr))
                 .parent_path() /
             "../client/public/maps/ironworks")
                .c_str(),
            0);
    GameServer gameServer;
    if (mode == "conquest") {
        const auto& zones = gameServer.m_mapPackage.manifest.zones;
        const auto count =
            std::count_if(zones.begin(), zones.end(),
                          [](const auto& z) { return z.type == "objective"; });
        if (count < 3 || count > 8)
            throw std::runtime_error("Conquest requires 3–8 objective zones");
        for (const std::string team : {"west", "east"})
            if (std::none_of(
                    gameServer.m_mapPackage.manifest.spawnPoints.begin(),
                    gameServer.m_mapPackage.manifest.spawnPoints.end(),
                    [&](const auto& spawn) {
                        return spawn.team == team &&
                               std::find(spawn.modes.begin(), spawn.modes.end(),
                                         "conquest") != spawn.modes.end();
                    }))
                throw std::runtime_error(
                    "Conquest requires deployment spawns for both teams");
    }
    gameServer.m_sessionConfiguration.buildId = buildId;
    gameServer.m_sessionConfiguration.mode = mode;
    gameServer.m_sessionConfiguration.maxPlayers =
        static_cast<std::size_t>(maxPlayers);
    std::shared_ptr<JoinTicketValidator> ticketValidator;
    if (!joinTicketSecret.empty()) {
        ticketValidator = std::make_shared<JoinTicketValidator>(
            joinTicketSecret, joinTicketAudience, serverId);
        gameServer.m_sessionConfiguration.authenticate =
            [ticketValidator](const std::optional<std::string>& ticket) {
                return ticket && ticketValidator->validate(*ticket);
            };
        std::cout
            << "[Security] Short-lived server-scoped join tickets required"
            << std::endl;
    } else {
        std::cout << "[Security] JOIN_TICKET_SECRET not set; only tokenless "
                     "local joins are accepted"
                  << std::endl;
    }
    SocketServer socketServer(gameServer, serverPort);

    // Initialize server registration if web API URL and secret are configured
    std::unique_ptr<ServerRegistration> registration;
    if (!webApiUrl.empty() && !sharedSecret.empty()) {
        registration = std::make_unique<ServerRegistration>(
            webApiUrl, serverId, serverHost, serverPort, serverRegion,
            maxPlayers, buildId, SessionConfiguration::ProtocolVersion,
            gameServer.m_mapPackage.manifest.mapId, mode,
            static_cast<int>(gameServer.m_mapPackage.manifest.formatVersion),
            gameServer.m_mapPackage.manifest.contentHash, websocketUrl,
            sharedSecret);

        // Register server with web API (async, non-blocking)
        registration->registerServerAsync();
        std::cout << "[Registration] Server registration initiated"
                  << std::endl;

        // Set registration in game server for heartbeat updates
        gameServer.setServerRegistration(registration.get());
        std::cout << "[Registration] Heartbeat will be sent every "
                  << gameServer.m_heartbeatInterval << " seconds from game loop"
                  << std::endl;
    } else {
        std::cout << "[Registration] Skipping registration (WEB_API_URL or "
                     "SERVER_SHARED_SECRET not set)"
                  << std::endl;
    }

    gameServer.run();
}
