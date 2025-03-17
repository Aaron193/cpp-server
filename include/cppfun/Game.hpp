#pragma once

#include "cppfun/GameServer.hpp"
#include "cppfun/SocketServer.hpp"
#include <cstdint>
#include <thread>

class Game {

public:
  GameServer m_game;
  SocketServer m_network;

  Game(uint16_t port);

private:
};