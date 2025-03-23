#include "client/Client.hpp"

#include "Systems.hpp"
#include "ecs/EntityManager.hpp"
#include "ecs/components.hpp"
#include "packet/buffer/PacketReader.hpp"

std::unordered_map<uint32_t, Client*> clients;
std::mutex clientsMutex;

Client::Client(uWS::WebSocket<false, true, WebSocketData>* ws, uint32_t id)
    : m_ws(ws), m_id(id) {
    changeBody(Systems::entityManager().createSpectator(entt::null));
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
        }
    }
}

void Client::onSpawn() {
    if (m_active) return;

    std::string name = m_reader.readString();

    m_name = name;
    m_active = true;

    m_writer.writeU8(ServerHeader::SPAWN_SUCCESS);
    m_writer.writeU32(m_id);
}

void Client::onMouse() {
    const float angle = m_reader.readFloat();
    m_angle = angle;
    std::cout << "User " << m_name << " has moved their mouse" << std::endl;
}

void Client::onMovement() {
    const uint8_t direction = m_reader.readU8();

    entt::registry& reg = Systems::entityManager().getRegistry();
    Components::Input& input = reg.get<Components::Input>(m_entity);
    input.direction = direction;
}

void Client::sendBytes() {
    if (!m_active) return;
    if (!m_writer.hasData()) return;

    m_ws->send(m_writer.getMessage(), uWS::OpCode::BINARY);
    m_writer.clear();
}

void Client::changeBody(entt::entity entity) {
    m_entity = entity;

    // link client to entity
    entt::registry& reg = Systems::entityManager().getRegistry();
    reg.emplace<Components::Client>(entity, m_id);

    // write set-camera packet with cam target entity
    m_writer.writeU8(ServerHeader::SET_CAMERA);
    Components::Camera& cam = reg.get<Components::Camera>(entity);
    m_writer.writeU32(static_cast<uint32_t>(cam.target));
}