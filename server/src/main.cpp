#include <box2d/box2d.h>
#include <uwebsockets/App.h>

#include <iostream>

#include "GameServer.hpp"
#include "SocketServer.hpp"
#include "VolcanicWorld.hpp"

int main() {
    std::cout << "Game has Started!" << std::endl;

    // GameServer gameServer;
    // SocketServer socketServer(gameServer, 9001);
    // gameServer.run();

    VolcanicWorld world;
    world.setMasterSeed(42);
    world.setIslandSize(0.8f);
    world.generateIsland(512, 512, "./output");

    // Generate JSON data
    world.generateBiomePolygons("./output/biome_regions.json");

    // Render visualization of the biome regions
    world.renderBiomeRegions("./output/biome_regions_rendered.png");
}
