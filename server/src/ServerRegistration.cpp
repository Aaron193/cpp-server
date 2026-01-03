#include "ServerRegistration.hpp"

#include <httplib.h>

#include <iostream>
#include <sstream>
#include <thread>

ServerRegistration::ServerRegistration(const std::string& webApiUrl,
                                       const std::string& serverId,
                                       const std::string& host, int port,
                                       const std::string& region,
                                       int maxPlayers,
                                       const std::string& sharedSecret)
    : m_webApiUrl(webApiUrl),
      m_serverId(serverId),
      m_host(host),
      m_port(port),
      m_region(region),
      m_maxPlayers(maxPlayers),
      m_sharedSecret(sharedSecret) {}

void ServerRegistration::registerServerAsync() {
    std::cout << "[ServerRegistration] Registering server with web API: "
              << m_webApiUrl << std::endl;

    // Build JSON payload
    std::ostringstream payload;
    payload << "{"
            << "\"id\":\"" << m_serverId << "\","
            << "\"host\":\"" << m_host << "\","
            << "\"port\":" << m_port << ","
            << "\"region\":\"" << m_region << "\","
            << "\"maxPlayers\":" << m_maxPlayers << "}";

    std::string body = payload.str();
    std::cout << "[ServerRegistration] Registration payload: " << body
              << std::endl;

    // Send async (non-blocking)
    sendHttpPostAsync("/servers/register", body);
}

void ServerRegistration::sendHeartbeatAsync(int currentPlayers) {
    // Build JSON payload
    std::ostringstream payload;
    payload << "{"
            << "\"id\":\"" << m_serverId << "\","
            << "\"currentPlayers\":" << currentPlayers << "}";

    std::string body = payload.str();
    std::cout << "[ServerRegistration] Sending heartbeat: " << currentPlayers
              << " players" << std::endl;

    // Send async (non-blocking)
    sendHttpPostAsync("/servers/heartbeat", body);
}

void ServerRegistration::sendHttpPostAsync(const std::string& endpoint,
                                           const std::string& jsonBody) {
    // Capture necessary data by value for the async thread
    std::string url = m_webApiUrl;
    std::string secret = m_sharedSecret;
    std::string body = jsonBody;
    std::string path = endpoint;

    // Spawn a detached thread to perform the HTTP request
    // This won't block the game loop
    std::thread([url, secret, body, path]() {
        try {
            // Create HTTP client
            httplib::Client client(url);
            client.set_connection_timeout(5);  // 5 seconds timeout
            client.set_read_timeout(5);
            client.set_write_timeout(5);

            // Set headers
            httplib::Headers headers = {{"Authorization", "Bearer " + secret},
                                        {"Content-Type", "application/json"}};

            // Make POST request
            auto res =
                client.Post(path.c_str(), headers, body, "application/json");

            if (res) {
                if (res->status == 200 || res->status == 201) {
                    std::cout
                        << "[ServerRegistration] HTTP POST successful: " << path
                        << " (status: " << res->status << ")" << std::endl;
                } else {
                    std::cerr
                        << "[ServerRegistration] HTTP POST failed: " << path
                        << " (status: " << res->status << ")" << std::endl;
                    std::cerr << "[ServerRegistration] Response: " << res->body
                              << std::endl;
                }
            } else {
                auto err = res.error();
                std::cerr << "[ServerRegistration] HTTP request failed: "
                          << path << std::endl;
                std::cerr << "[ServerRegistration] Error: "
                          << httplib::to_string(err) << std::endl;
            }
        } catch (const std::exception& e) {
            std::cerr << "[ServerRegistration] Exception during HTTP request: "
                      << e.what() << std::endl;
        }
    }).detach();
}
