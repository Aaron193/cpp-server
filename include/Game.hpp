#pragma once

#include <cstdint>

#include "GameServer.hpp"
#include "SocketServer.hpp"

class Game {
   public:
    GameServer m_game;
    SocketServer m_network;

    Game(uint16_t port);

   private:
};