#pragma once

#include <string>

class ServerRegistration {
   public:
    ServerRegistration(const std::string& webApiUrl,
                       const std::string& serverId, const std::string& host,
                       int port, const std::string& region, int maxPlayers,
                       const std::string& sharedSecret);

    ~ServerRegistration() = default;

    // Register the server with the web API (async, non-blocking)
    void registerServerAsync();

    // Send heartbeat with current player count (async, non-blocking)
    void sendHeartbeatAsync(int currentPlayers);

   private:
    void sendHttpPostAsync(const std::string& endpoint,
                           const std::string& jsonBody);

    std::string m_webApiUrl;
    std::string m_serverId;
    std::string m_host;
    int m_port;
    std::string m_region;
    int m_maxPlayers;
    std::string m_sharedSecret;
};
