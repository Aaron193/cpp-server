#include <box2d/box2d.h>
#include <uwebsockets/App.h>

#include <cstdlib>
#include <iostream>

#include "GameServer.hpp"
#include "ServerRegistration.hpp"
#include "SocketServer.hpp"

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
    int maxPlayers = std::stoi(getEnvVar("MAX_PLAYERS", "100"));
    std::string webApiUrl = getEnvVar("WEB_API_URL", "localhost:3000");
    std::string sharedSecret = getEnvVar("SERVER_SHARED_SECRET", "");

    std::cout << "[Config] Server ID: " << serverId << std::endl;
    std::cout << "[Config] Host: " << serverHost << ":" << serverPort
              << std::endl;
    std::cout << "[Config] Region: " << serverRegion << std::endl;
    std::cout << "[Config] Max Players: " << maxPlayers << std::endl;
    std::cout << "[Config] Web API: " << webApiUrl << std::endl;

    GameServer gameServer;
    SocketServer socketServer(gameServer, serverPort);

    // Initialize server registration if web API URL and secret are configured
    std::unique_ptr<ServerRegistration> registration;
    if (!webApiUrl.empty() && !sharedSecret.empty()) {
        registration = std::make_unique<ServerRegistration>(
            webApiUrl, serverId, serverHost, serverPort, serverRegion,
            maxPlayers, sharedSecret);

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
