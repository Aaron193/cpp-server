#pragma once

#include <atomic>
#include <thread>

class GameServer {
   public:
    GameServer() noexcept;
    ~GameServer();

    void start();
    void stop();

   private:
    std::thread m_serverThread;
    std::atomic<bool> m_running;

    void run();
    void tick(double delta);
    void updateClientCameras();
    void syncClients();
    void clientInput();
};