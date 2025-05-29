#include "client/Client.hpp"

#include <box2d/b2_body.h>
#include <box2d/b2_collision.h>
#include <box2d/b2_math.h>
#include <box2d/b2_world.h>

#include <iostream>

#include "ecs/EntityManager.hpp"
#include "ecs/components.hpp"
#include "packet/buffer/PacketReader.hpp"
#include "physics/PhysicsWorld.hpp"
#include "util/units.hpp"

Client::Client(GameServer& gameServer,
               uWS::WebSocket<false, true, WebSocketData>* ws, uint32_t id)
    : m_gameServer(gameServer), m_ws(ws), m_id(id) {
    changeBody(m_gameServer.m_entityManager.createSpectator(entt::null));

    // the caller holds the lock, we are safe to access m_clients... (Maybe use
    // recursive mutex to avoid deadlocks?)
    for (auto& [id, client] : m_gameServer.m_clients) {
        if (client->m_active) {
            m_writer.writeU8(ServerHeader::PLAYER_JOIN);
            m_writer.writeU32(static_cast<uint32_t>(client->m_entity));
            m_writer.writeString(client->m_name);
        }
    }
}

Client::~Client() {
    std::cout << "User " << m_name << " has disconnected" << std::endl;
}

void Client::onMessage(const std::string_view& message) {
    m_reader.loadMessage(message);

    while (m_reader.getOffset() < m_reader.byteLength()) {
        const uint8_t header = m_reader.readU8();

        switch (header) {
            case ClientHeader::SPAWN:
                onSpawn();
                break;
            case ClientHeader::MOUSE:
                onMouse();
                break;
            case ClientHeader::MOVEMENT:
                onMovement();
                break;
            case ClientHeader::MOUSE_DOWN:
                onMouseClick(true);
                break;
            case ClientHeader::MOUSE_UP:
                onMouseClick(false);
                break;
        }
    }
}

void Client::onSpawn() {
    if (m_active) return;

    std::string name = m_reader.readString();

    m_name = name;
    m_active = true;

    // TODO: maybe add this scheduleForRemoval to the changeBody method...
    m_gameServer.m_entityManager.scheduleForRemoval(m_entity);
    changeBody(m_gameServer.m_entityManager.createPlayer());

    m_writer.writeU8(ServerHeader::SPAWN_SUCCESS);
    m_writer.writeU32(static_cast<uint32_t>(m_entity));
    m_writer.writeU8(this->m_gameServer.m_tps);
    std::cout << "User " << m_name << " has connected" << std::endl;

    // notify clients about our new player
    // the caller holds the lock, we are safe to access m_clients... (Maybe use
    // recursive mutex to avoid deadlocks?)
    for (auto& [id, client] : m_gameServer.m_clients) {
        client->m_writer.writeU8(ServerHeader::PLAYER_JOIN);
        client->m_writer.writeU32(static_cast<uint32_t>(m_entity));
        client->m_writer.writeString(m_name);
    }
}

void Client::onClose() {
    // the caller holds the lock, we are safe to access m_clients... (Maybe use
    // recursive mutex to avoid deadlocks?)
    for (auto& [id, client] : m_gameServer.m_clients) {
        if (client != this) {
            client->m_writer.writeU8(ServerHeader::PLAYER_LEAVE);
            client->m_writer.writeU32(static_cast<uint32_t>(m_entity));
        }
    }
}

void Client::onMouse() {
    const float angle = m_reader.readFloat();

    if (!m_active) {
        return;
    }

    entt::registry& reg = m_gameServer.m_entityManager.getRegistry();
    Components::Input& input = reg.get<Components::Input>(m_entity);
    input.angle = angle;
}

void Client::onMovement() {
    const uint8_t direction = m_reader.readU8();

    if (!m_active) {
        return;
    }

    entt::registry& reg = m_gameServer.m_entityManager.getRegistry();
    Components::Input& input = reg.get<Components::Input>(m_entity);
    input.direction = direction;
}

// @TODO: when the user clicks mouse really fast, it wont register because
// it will isDown will be false by the time it gets proccessed
void Client::onMouseClick(bool isDown) {
    if (!m_active) {
        return;
    }

    entt::registry& reg = m_gameServer.m_entityManager.getRegistry();
    Components::Input& input = reg.get<Components::Input>(m_entity);

    input.mouseIsDown = isDown;
}

void Client::writeGameState() {
    entt::registry& reg = m_gameServer.m_entityManager.getRegistry();

    Components::Camera& cam = reg.get<Components::Camera>(m_entity);

    // pos is last camera position if target is invalid
    b2Vec2 pos =
        cam.target == entt::null
            ? cam.position
            : reg.get<Components::Body>(cam.target).body->GetPosition();

    float halfViewX = meters(cam.width) * 0.5;
    float halfViewY = meters(cam.height) * 0.5;

    // TODO: avoid stack object allocation?
    b2AABB queryAABB;
    queryAABB.lowerBound = b2Vec2(pos.x - halfViewX, pos.y - halfViewY);
    queryAABB.upperBound = b2Vec2(pos.x + halfViewX, pos.y + halfViewY);

    b2World* world = m_gameServer.m_physicsWorld.m_world.get();

    PhysicsWorld& physicsWorld = m_gameServer.m_physicsWorld;
    physicsWorld.m_queryCallback->entities.clear();
    world->QueryAABB(physicsWorld.m_queryCallback, queryAABB);

    std::unordered_set<entt::entity> currentlyVisibleEntities;
    for (entt::entity entity : physicsWorld.m_queryCallback->entities) {
        currentlyVisibleEntities.insert(entity);
    }

    std::vector<entt::entity> create;
    std::vector<entt::entity> update;
    std::vector<entt::entity> remove;

    for (entt::entity entity : currentlyVisibleEntities) {
        if (m_previousVisibleEntities.find(entity) ==
            m_previousVisibleEntities.end()) {
            create.push_back(entity);
        } else {
            update.push_back(entity);
        }
    }

    for (entt::entity entity : m_previousVisibleEntities) {
        if (currentlyVisibleEntities.find(entity) ==
            currentlyVisibleEntities.end()) {
            remove.push_back(entity);
        }
    }

    // Entity creation serialization (entity has entered the client's view)
    if (!create.empty()) {
        m_writer.writeU8(ServerHeader::ENTITY_CREATE);
        m_writer.writeU32(static_cast<uint32_t>(create.size()));

        for (entt::entity entity : create) {
            b2Body* body = reg.get<Components::Body>(entity).body;
            uint8_t type = reg.get<Components::Type>(entity).type;

            m_writer.writeU32(static_cast<uint32_t>(entity));
            m_writer.writeU8(type);
            m_writer.writeFloat(pixels(body->GetPosition().x));
            m_writer.writeFloat(pixels(body->GetPosition().y));
            m_writer.writeFloat(body->GetAngle());
        }
    }

    // Entity update serialization (entity is still in the client's view)
    if (!update.empty()) {
        m_writer.writeU8(ServerHeader::ENTITY_UPDATE);
        m_writer.writeU32(static_cast<uint32_t>(update.size()));
        for (entt::entity entity : update) {
            Components::Body& body = reg.get<Components::Body>(entity);

            m_writer.writeU32(static_cast<uint32_t>(entity));
            m_writer.writeFloat(pixels(body.body->GetPosition().x));
            m_writer.writeFloat(pixels(body.body->GetPosition().y));
            m_writer.writeFloat(body.body->GetAngle());
        }
    }

    // Entity removal serialization (entity has left the client's view)
    if (!remove.empty()) {
        std::cout << "removing an entity!" << std::endl;
        m_writer.writeU8(ServerHeader::ENTITY_REMOVE);
        m_writer.writeU32(static_cast<uint32_t>(remove.size()));
        for (entt::entity entity : remove) {
            m_writer.writeU32(static_cast<uint32_t>(entity));
        }
    }

    m_previousVisibleEntities.swap(currentlyVisibleEntities);
}

void Client::sendBytes() {
    if (!m_writer.hasData()) return;

    m_ws->send(m_writer.getMessage(), uWS::OpCode::BINARY);
    m_writer.clear();
}

void Client::changeBody(entt::entity entity) {
    m_entity = entity;

    // link client to entity
    entt::registry& reg = m_gameServer.m_entityManager.getRegistry();
    reg.emplace<Components::Client>(entity, m_id);

    // write set-camera packet with cam target entity
    m_writer.writeU8(ServerHeader::SET_CAMERA);
    Components::Camera& cam = reg.get<Components::Camera>(entity);
    m_writer.writeU32(static_cast<uint32_t>(cam.target));
}