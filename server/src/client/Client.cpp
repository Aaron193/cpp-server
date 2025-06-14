#include "client/Client.hpp"

#include <box2d/b2_body.h>
#include <box2d/b2_collision.h>
#include <box2d/b2_math.h>
#include <box2d/b2_world.h>

#include <iostream>
#include <unordered_set>

#include "ecs/EntityManager.hpp"
#include "ecs/components.hpp"
#include "packet/buffer/PacketReader.hpp"
#include "physics/PhysicsWorld.hpp"
#include "util/units.hpp"

Client::Client(GameServer& gameServer,
               uWS::WebSocket<false, true, WebSocketData>* ws, uint32_t id)
    : m_gameServer(gameServer), m_ws(ws), m_id(id) {
    changeBody(m_gameServer.m_entityManager.createSpectator(entt::null));

    for (auto& [id, client] : m_gameServer.m_clients) {
        m_writer.writeU8(ServerHeader::PLAYER_JOIN);
        m_writer.writeU32(static_cast<uint32_t>(client->m_entity));
        m_writer.writeString(client->m_name);
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

// clientsWitness: explicitly show that the caller holds the lock, we are safe
// to access m_clients...
void Client::onSpawn() {
    if (m_active) return;

    std::string name = m_reader.readString();

    m_name = name;
    m_active = true;

    // TODO: maybe add this scheduleForRemoval to the changeBody method...
    m_gameServer.m_entityManager.scheduleForRemoval(m_entity);
    changeBody(m_gameServer.m_entityManager.createPlayer());

    // @TODO: this needs to be a HANDSHAKE and done ASAP, we cannot give tps
    // when the player spawns because they need the tps before they spawn when
    // spectating
    m_writer.writeU8(ServerHeader::SPAWN_SUCCESS);
    m_writer.writeU32(static_cast<uint32_t>(m_entity));
    m_writer.writeU8(m_gameServer.m_tps);
    std::cout << "User " << m_name << " has connected" << std::endl;

    // notify clients about our new player
    for (auto& [id, client] : m_gameServer.m_clients) {
        client->m_writer.writeU8(ServerHeader::PLAYER_JOIN);
        client->m_writer.writeU32(static_cast<uint32_t>(m_entity));
        client->m_writer.writeString(m_name);
    }
}

void Client::onClose() {
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
    assert(reg.all_of<Components::Input>(m_entity));
    Components::Input& input = reg.get<Components::Input>(m_entity);
    input.angle = angle;
}

void Client::onMovement() {
    const uint8_t direction = m_reader.readU8();

    if (!m_active) {
        return;
    }

    entt::registry& reg = m_gameServer.m_entityManager.getRegistry();
    assert(reg.all_of<Components::Input>(m_entity));
    Components::Input& input = reg.get<Components::Input>(m_entity);
    input.direction = direction;
}

void Client::onMouseClick(bool isDown) {
    if (!m_active) {
        return;
    }

    entt::registry& reg = m_gameServer.m_entityManager.getRegistry();
    assert(reg.all_of<Components::Input>(m_entity));
    Components::Input& input = reg.get<Components::Input>(m_entity);

    input.mouseIsDown = isDown;
    if (isDown) input.dirtyClick = true;
}

void Client::writeGameState() {
    entt::registry& reg = m_gameServer.m_entityManager.getRegistry();

    assert(reg.all_of<Components::Camera>(m_entity));

    // Static variables to avoid repeated allocations
    static std::vector<entt::entity> createEntities;
    static std::vector<entt::entity> updateEntities;
    static std::vector<entt::entity> removeEntities;
    static std::unordered_set<entt::entity> currentlyVisibleEntities;

    createEntities.clear();
    updateEntities.clear();
    removeEntities.clear();
    currentlyVisibleEntities.clear();

    Components::Camera& cam = reg.get<Components::Camera>(m_entity);
    bool targetValid = (cam.target != entt::null && reg.valid(cam.target));
    const b2Vec2& pos =
        targetValid
            ? reg.get<Components::EntityBase>(cam.target).body->GetPosition()
            : cam.position;
    float halfViewX = meters(cam.width) * 0.5f;
    float halfViewY = meters(cam.height) * 0.5f;

    b2AABB queryAABB;
    queryAABB.lowerBound = b2Vec2(pos.x - halfViewX, pos.y - halfViewY);
    queryAABB.upperBound = b2Vec2(pos.x + halfViewX, pos.y + halfViewY);

    b2World* world = m_gameServer.m_physicsWorld.m_world.get();
    PhysicsWorld& physicsWorld = m_gameServer.m_physicsWorld;
    physicsWorld.m_QueryNetworkedEntities->Clear();
    world->QueryAABB(physicsWorld.m_QueryNetworkedEntities, queryAABB);

    for (const entt::entity& entity :
         physicsWorld.m_QueryNetworkedEntities->entities) {
        currentlyVisibleEntities.insert(entity);
    }

    // most of these entities are going to go into the update list
    createEntities.reserve(currentlyVisibleEntities.size());
    updateEntities.reserve(currentlyVisibleEntities.size());

    for (const entt::entity& entity : currentlyVisibleEntities) {
        if (m_previousVisibleEntities.find(entity) ==
            m_previousVisibleEntities.end()) {
            createEntities.push_back(entity);
        } else {
            updateEntities.push_back(entity);
        }
    }

    for (const entt::entity& entity : m_previousVisibleEntities) {
        if (currentlyVisibleEntities.find(entity) ==
            currentlyVisibleEntities.end()) {
            removeEntities.push_back(entity);
        }
    }

    auto baseView = reg.view<Components::EntityBase>();
    auto stateView = reg.view<Components::State>();

    if (!createEntities.empty()) {
        m_writer.writeU8(ServerHeader::ENTITY_CREATE);
        m_writer.writeU32(static_cast<uint32_t>(createEntities.size()));

        for (entt::entity entity : createEntities) {
            assert(reg.all_of<Components::EntityBase>(entity));

            auto& base = baseView.get<Components::EntityBase>(entity);
            b2Body* body = base.body;
            assert(body != nullptr);
            const b2Vec2& position = body->GetPosition();
            uint8_t type = base.type;

            m_writer.writeU32(static_cast<uint32_t>(entity));
            m_writer.writeU8(type);
            m_writer.writeFloat(pixels(position.x));
            m_writer.writeFloat(pixels(position.y));
            m_writer.writeFloat(body->GetAngle());
        }
    }

    if (!updateEntities.empty()) {
        m_writer.writeU8(ServerHeader::ENTITY_UPDATE);
        m_writer.writeU32(static_cast<uint32_t>(updateEntities.size()));

        for (const entt::entity& entity : updateEntities) {
            assert(reg.all_of<Components::EntityBase>(entity));

            b2Body* body = baseView.get<Components::EntityBase>(entity).body;
            assert(body != nullptr);
            const b2Vec2& position = body->GetPosition();

            m_writer.writeU32(static_cast<uint32_t>(entity));
            m_writer.writeFloat(pixels(position.x));
            m_writer.writeFloat(pixels(position.y));
            m_writer.writeFloat(body->GetAngle());
        }
    }

    if (!removeEntities.empty()) {
        m_writer.writeU8(ServerHeader::ENTITY_REMOVE);
        m_writer.writeU32(static_cast<uint32_t>(removeEntities.size()));

        for (entt::entity entity : removeEntities) {
            m_writer.writeU32(static_cast<uint32_t>(entity));
        }
    }

    // Write entity states
    for (entt::entity entity :
         physicsWorld.m_QueryNetworkedEntities->entities) {
        // if entity has state component, notify client of the state
        if (reg.all_of<Components::State>(entity)) {
            Components::State& state = reg.get<Components::State>(entity);
            if (!state.isIdle()) {
                m_writer.writeU8(ServerHeader::ENTITY_STATE);
                m_writer.writeU32(static_cast<uint32_t>(entity));
                m_writer.writeU8(state.state);
            }
        }
    }

    // Spectator clients don't have a health component, we must runtime check
    if (reg.all_of<Components::Health>(m_entity)) {
        Components::Health& health = reg.get<Components::Health>(m_entity);
        if (health.dirty) {
            m_writer.writeU8(ServerHeader::HEALTH);
            m_writer.writeFloat(health.current / health.max);
            health.dirty = false;
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

    assert(reg.all_of<Components::Camera>(entity));

    // write set-camera packet with cam target entity
    m_writer.writeU8(ServerHeader::SET_CAMERA);
    Components::Camera& cam = reg.get<Components::Camera>(entity);
    m_writer.writeU32(static_cast<uint32_t>(cam.target));
}