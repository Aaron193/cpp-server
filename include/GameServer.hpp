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
    void run();
    void tick(double delta);

    std::thread m_serverThread;
    std::atomic<bool> m_running;
};