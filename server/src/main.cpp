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
    world.setMasterSeed(12345);
    world.setIslandSize(0.75f);
    world.generateIsland(512, 512, "./output");

    // Build terrain meshes using the new pipeline
    auto meshes = world.buildTerrainMeshes();

    // Save meshes to JSON (efficient format with vertices + indices)
    world.saveTerrainMeshesJSON(meshes, "./output/terrain_meshes.json");

    std::cout << "Total terrain meshes generated: " << meshes.size() << "\n";

    // Print summary
    int totalTriangles = 0;
    for (const auto& mesh : meshes) {
        totalTriangles += mesh.indices.size() / 3;
    }
    std::cout << "Total triangles: " << totalTriangles << "\n";
}
