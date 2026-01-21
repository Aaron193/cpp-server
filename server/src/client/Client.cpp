#include "client/Client.hpp"

#include <box2d/box2d.h>

#include <iostream>
#include <unordered_set>

#include "GameServer.hpp"
#include "World.hpp"
#include "common/enums.hpp"
#include "ecs/EntityManager.hpp"
#include "ecs/components.hpp"
#include "packet/buffer/PacketReader.hpp"
#include "physics/CollisionHelpers.hpp"
#include "physics/PhysicsWorld.hpp"
#include "util/units.hpp"

Client::Client(GameServer& gameServer,
               uWS::WebSocket<false, true, WebSocketData>* ws, uint32_t id)
    : m_gameServer(gameServer), m_ws(ws), m_id(id) {
    changeBody(m_gameServer.m_entityManager.createSpectator(entt::null));

    // send server tps
    m_writer.writeU8(ServerHeader::TPS);
    m_writer.writeU8(m_gameServer.m_tps);

    m_writer.writeU8(ServerHeader::MAP_INIT);
    m_writer.writeU32(
        static_cast<uint32_t>(m_gameServer.m_worldGenerator->GetWorldSize()));

    // tell our player about others
    for (auto& [id, client] : m_gameServer.m_clients) {
        m_writer.writeU8(ServerHeader::PLAYER_JOIN);
        m_writer.writeU32(static_cast<uint32_t>(client->m_entity));
        m_writer.writeString(client->m_name);
    }
}

Client::~Client() {}

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
            case ClientHeader::CLIENT_CHAT:
                onChat();
                break;
            case ClientHeader::RELOAD:
                onReload();
                break;
            case ClientHeader::SWITCH_ITEM:
                onSwitchItem();
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
    std::cout << "User " << m_name << " has connected" << std::endl;

    // serialize the client with the map data
    sendTerrainMeshes();

    // notify clients about our new player
    for (auto& [id, client] : m_gameServer.m_clients) {
        client->m_writer.writeU8(ServerHeader::PLAYER_JOIN);
        client->m_writer.writeU32(static_cast<uint32_t>(m_entity));
        client->m_writer.writeString(m_name);

        client->m_writer.writeU8(ServerHeader::NEWS);
        client->m_writer.writeU8(NewsType::TEXT);
        client->m_writer.writeString(m_name + " has joined the game!!");
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

void Client::onChat() {
    std::string message = m_reader.readString();

    if (!m_active) {
        return;
    }

    if (message.length() > 50) {
        return;
    }

    for (auto& [id, client] : m_gameServer.m_clients) {
        if (client->m_previousVisibleEntities.find(m_entity) !=
            client->m_previousVisibleEntities.end()) {
            client->m_writer.writeU8(ServerHeader::SERVER_CHAT);
            client->m_writer.writeU32(static_cast<uint32_t>(m_entity));
            client->m_writer.writeString(message);
        }
    }
}

void Client::onReload() {
    if (!m_active) {
        return;
    }

    entt::registry& reg = m_gameServer.m_entityManager.getRegistry();
    if (!reg.all_of<Components::Input>(m_entity)) return;
    Components::Input& input = reg.get<Components::Input>(m_entity);
    input.reloadRequested = true;
}

void Client::onSwitchItem() {
    if (!m_active) {
        return;
    }

    const uint8_t slot = m_reader.readU8();

    entt::registry& reg = m_gameServer.m_entityManager.getRegistry();
    if (!reg.all_of<Components::Input>(m_entity)) return;
    Components::Input& input = reg.get<Components::Input>(m_entity);
    input.switchSlot = static_cast<int8_t>(slot);
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
        targetValid ? b2Body_GetPosition(
                          reg.get<Components::EntityBase>(cam.target).bodyId)
                    : cam.position;
    float halfViewX = meters(cam.width) * 0.5f;
    float halfViewY = meters(cam.height) * 0.5f;

    b2AABB queryAABB;
    queryAABB.lowerBound = {pos.x - halfViewX, pos.y - halfViewY};
    queryAABB.upperBound = {pos.x + halfViewX, pos.y + halfViewY};

    PhysicsWorld& physicsWorld = m_gameServer.m_physicsWorld;

    // In Box2D v3, we query all networked entities manually instead of using
    // QueryAABB callback
    auto networkedView =
        reg.view<Components::EntityBase, Components::Networked>();
    std::vector<entt::entity> visibleNetworkedEntities;

    for (auto entity : networkedView) {
        auto& base = networkedView.get<Components::EntityBase>(entity);
        if (B2_IS_NON_NULL(base.bodyId)) {
            if (!b2Body_IsEnabled(base.bodyId)) {
                continue;
            }
            b2Vec2 entityPos = b2Body_GetPosition(base.bodyId);
            if (AABBCollision::pointInAABB(entityPos, queryAABB)) {
                visibleNetworkedEntities.push_back(entity);
            }
        }
    }

    for (const entt::entity& entity : visibleNetworkedEntities) {
        currentlyVisibleEntities.insert(entity);
    }

    auto baseView = reg.view<Components::EntityBase>();
    auto stateView = reg.view<Components::State>();

    // most of these entities are going to go into the update list
    createEntities.reserve(currentlyVisibleEntities.size());
    updateEntities.reserve(currentlyVisibleEntities.size());

    for (const entt::entity& entity : currentlyVisibleEntities) {
        if (m_previousVisibleEntities.find(entity) ==
            m_previousVisibleEntities.end()) {
            createEntities.push_back(entity);
        } else {
            // Only send updates for dynamic bodies (skip static structures)
            auto& base = baseView.get<Components::EntityBase>(entity);
            if (B2_IS_NON_NULL(base.bodyId) &&
                b2Body_GetType(base.bodyId) != b2_staticBody) {
                updateEntities.push_back(entity);
            }
        }
    }

    for (const entt::entity& entity : m_previousVisibleEntities) {
        if (currentlyVisibleEntities.find(entity) ==
            currentlyVisibleEntities.end()) {
            removeEntities.push_back(entity);
        }
    }

    if (!createEntities.empty()) {
        m_writer.writeU8(ServerHeader::ENTITY_CREATE);
        m_writer.writeU32(static_cast<uint32_t>(createEntities.size()));

        for (entt::entity entity : createEntities) {
            assert(reg.all_of<Components::EntityBase>(entity));

            auto& base = baseView.get<Components::EntityBase>(entity);
            b2BodyId bodyId = base.bodyId;
            assert(B2_IS_NON_NULL(bodyId));
            const b2Vec2& position = b2Body_GetPosition(bodyId);
            uint8_t type = base.type;

            m_writer.writeU32(static_cast<uint32_t>(entity));
            m_writer.writeU8(type);
            m_writer.writeU8(base.variant);
            m_writer.writeFloat(pixels(position.x));
            m_writer.writeFloat(pixels(position.y));
            m_writer.writeFloat(b2Rot_GetAngle(b2Body_GetRotation(bodyId)));
        }
    }

    if (!updateEntities.empty()) {
        m_writer.writeU8(ServerHeader::ENTITY_UPDATE);
        m_writer.writeU32(static_cast<uint32_t>(updateEntities.size()));

        for (const entt::entity& entity : updateEntities) {
            assert(reg.all_of<Components::EntityBase>(entity));

            auto& base = baseView.get<Components::EntityBase>(entity);
            b2BodyId bodyId = base.bodyId;
            assert(B2_IS_NON_NULL(bodyId));
            const b2Vec2& position = b2Body_GetPosition(bodyId);

            m_writer.writeU32(static_cast<uint32_t>(entity));
            m_writer.writeFloat(pixels(position.x));
            m_writer.writeFloat(pixels(position.y));
            m_writer.writeFloat(b2Rot_GetAngle(b2Body_GetRotation(bodyId)));
        }
    }

    if (!removeEntities.empty()) {
        m_writer.writeU8(ServerHeader::ENTITY_REMOVE);
        m_writer.writeU32(static_cast<uint32_t>(removeEntities.size()));

        for (entt::entity entity : removeEntities) {
            m_writer.writeU32(static_cast<uint32_t>(entity));
        }
    }

    // Write entity states - iterate through currentlyVisibleEntities instead of
    // query result
    for (entt::entity entity : currentlyVisibleEntities) {
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

    if (reg.all_of<Components::Inventory>(m_entity)) {
        Components::Inventory& inventory =
            reg.get<Components::Inventory>(m_entity);

        bool inventoryDirty = inventory.dirty;

        if (inventoryDirty) {
            m_writer.writeU8(ServerHeader::INVENTORY_UPDATE);
            m_writer.writeU8(inventory.activeSlot);

            uint8_t slotCount = inventory.countOccupiedSlots();

            m_writer.writeU8(slotCount);

            for (size_t i = 0; i < inventory.slots.size(); ++i) {
                const auto& slot = inventory.slots[i];
                if (slot.type == ItemType::ITEM_NONE) {
                    continue;
                }

                m_writer.writeU8(static_cast<uint8_t>(i));
                m_writer.writeU8(static_cast<uint8_t>(slot.type));

                if (slot.isGun()) {
                    m_writer.writeU8(static_cast<uint8_t>(slot.gun.fireMode));
                    m_writer.writeU8(static_cast<uint8_t>(slot.gun.ammoType));
                    m_writer.writeU16(
                        static_cast<uint16_t>(slot.gun.magazineSize));
                    m_writer.writeU16(
                        static_cast<uint16_t>(slot.gun.ammoInMag));
                    m_writer.writeFloat(slot.gun.reloadRemaining);
                }
            }

            inventory.dirty = false;
        }

        const auto& activeSlot = inventory.getActive();
        bool needsAmmoUpdate = inventoryDirty;
        if (activeSlot.isGun() && activeSlot.gun.reloadRemaining > 0.0f) {
            needsAmmoUpdate = true;
        }

        if (needsAmmoUpdate && activeSlot.isGun() &&
            reg.all_of<Components::Ammo>(m_entity)) {
            Components::Ammo& ammo = reg.get<Components::Ammo>(m_entity);
            m_writer.writeU8(ServerHeader::AMMO_UPDATE);
            m_writer.writeU16(static_cast<uint16_t>(activeSlot.gun.ammoInMag));
            m_writer.writeU16(
                static_cast<uint16_t>(ammo.get(activeSlot.gun.ammoType)));
            m_writer.writeFloat(activeSlot.gun.reloadRemaining);
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

// Send all terrain meshes once to this client. Uses a compact vertex encoding
// when the world fits in 16-bit grid coordinates; otherwise falls back to
// floats.
void Client::sendTerrainMeshes() {
    if (m_sentTerrainMeshes) return;

    const auto& meshes = m_gameServer.m_terrainMeshes;
    const uint32_t worldSize = m_gameServer.m_worldGenerator->GetWorldSize();
    const bool useU16 = worldSize <= std::numeric_limits<uint16_t>::max();

    for (size_t biomeIdx = 0; biomeIdx < meshes.size(); ++biomeIdx) {
        const TerrainMesh& mesh = meshes[biomeIdx];

        m_writer.writeU8(ServerHeader::BIOME_CREATE);
        m_writer.writeU32(static_cast<uint32_t>(biomeIdx));
        m_writer.writeU8(static_cast<uint8_t>(mesh.biome));

        // Encoding flag: 0 = float world pixels, 1 = uint16 heightmap units
        m_writer.writeU8(useU16 ? 1 : 0);

        // Write vertices
        m_writer.writeU32(static_cast<uint32_t>(mesh.vertices.size()));
        if (useU16) {
            for (const Vec2& v : mesh.vertices) {
                // Clamp to u16 bounds just in case
                uint16_t vx = static_cast<uint16_t>(
                    std::clamp(v.x, 0.0f, static_cast<float>(worldSize)));
                uint16_t vy = static_cast<uint16_t>(
                    std::clamp(v.y, 0.0f, static_cast<float>(worldSize)));
                m_writer.writeU16(vx);
                m_writer.writeU16(vy);
            }
        } else {
            for (const Vec2& v : mesh.vertices) {
                m_writer.writeFloat(v.x * 64.0f);
                m_writer.writeFloat(v.y * 64.0f);
            }
        }

        // Write indices
        m_writer.writeU32(static_cast<uint32_t>(mesh.indices.size()));
        for (uint32_t idx : mesh.indices) {
            m_writer.writeU32(idx);
        }
    }

    m_sentTerrainMeshes = true;
}
