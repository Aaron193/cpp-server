# Multiplayer Game (C++ backend, TypeScript frontend)

A real-time multiplayer game built with C++ server and TypeScript client, including custom networking protocols, physics simulation, and client-side prediction.

![C++ Game Demo](cpp_game.gif)

## Overview

This project is an educational multiplayer game implementation that showcases:

-   **Custom C++ Game Server**: High-performance server architecture with entity component system (ECS)
-   **TypeScript Client**: Game can be played in a web browser
-   **Real-time Networking**: Custom binary protocol for efficient client-server communication
-   **Physics Simulation**: Server-authoritative physics using Box2D
-   **Entity Management**: Component-based architecture for scalability and managing entities

## Features

-   Real-time multiplayer gameplay with low-latency networking
-   Client-side interpolation for smooth movement
-   Server-authoritative physics and collision detection
-   Custom binary packet serialization
-   WebSocket (TCP) networking
-   Entity Component System (ECS) architecture

## Tech Stack

### Server (C++)

-   **Language**: C++17
-   **Build System**: CMake 3.10+
-   **Package Manager**: vcpkg

**Core Dependencies**:

-   **Box2D** - Industry-standard 2D physics engine for collision detection and rigid body dynamics
-   **uWebSockets** - High-performance WebSocket library for real-time client-server communication (This is what Bun.js uses natively for networking)
-   **EnTT** - Fast and reliable Entity Component System (ECS) library for game entity management

### Client (TypeScript)

-   **Language**: TypeScript 5.6+
-   **Build Tools**: Webpack 5 with development server

**Core Dependencies**:

-   **PixiJS 8.9** - Hardware-accelerated 2D rendering engine using WebGL, providing sprite rendering, animation, and more

**Development Tools**:

-   **Webpack** - Module bundler with hot reload support
-   **TypeScript Loader** - Compiles TypeScript to JavaScript
-   **CSS Loaders** - Processes and bundles stylesheets
-   **HTML Plugin** - Generates and injects bundles into HTML
-   **Copy Plugin** - Manages static assets
-   **Clean Plugin** - Cleans build directories

## Project Structure

```
├── server/              # C++ game server
│   ├── src/            # Server source files
│   ├── include/        # Header files
│   └── CMakeLists.txt  # Build configuration
└── client/             # TypeScript client
    ├── src/            # Client source files
    ├── package.json    # Dependencies
    └── webpack.config.js
```

## Building & Running

### Prerequisites

**Server**:

-   CMake 3.10 or higher
-   C++17 compatible compiler (GCC, Clang, or MSVC)
-   vcpkg package manager
-   Environment variable `VCPKG_ROOT` set to your vcpkg installation path

**Client**:

-   Node.js and npm

### Server

```bash
cd server
./build.sh
./build/server
```

### Client

```bash
cd client
npm install
npm run build
npm start
```

## License

This project is licensed under the terms found in the [LICENSE](LICENSE) file.

## Contributing

While this is primarily a learning project, suggestions and feedback are welcome! Feel free to open an issue or submit a pull request.
