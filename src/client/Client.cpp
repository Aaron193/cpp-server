#include "../include/cppfun/client/Client.hpp"
#include "../include/cppfun/packet/buffer/PacketReader.hpp"
#include "cppfun/packet/Packet.hpp"

std::pmr::unordered_map<uint32_t, Client *> clients;
std::mutex clientsMutex;

Client::Client(uWS::WebSocket<false, true, WebSocketData> *ws, uint32_t id)
    : m_ws(ws), m_id(id) {}

Client::~Client() {
  std::cout << "User " << m_name << " has disconnected" << std::endl;
}

void Client::onMessage(const std::string_view &message) {
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
  if (m_active)
    return;

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

  uint8_t x = 0;
  uint8_t y = 0;

  if (direction & 1)
    y--;
  if (direction & 2)
    x--;
  if (direction & 4)
    y++;
  if (direction & 8)
    x++;

  m_velocity.x = x;
  m_velocity.y = y;
}

void Client::sendBytes() {
  if (!m_active)
    return;

  if (m_writer.hasData() == 0)
    return;

  m_ws->send(m_writer.getMessage(), uWS::OpCode::BINARY);
  m_writer.clear();
}