#include <box2d/box2d.h>
#include <uwebsockets/App.h>

#include <iostream>

#include "GameServer.hpp"
#include "SocketServer.hpp"

int main() {
    std::cout << "Game has Started!" << std::endl;

    GameServer gameServer;
    SocketServer socketServer(gameServer, 9001);
    gameServer.run();
}
