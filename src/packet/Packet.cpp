// #include "cppfun/packet/Packet.hpp"
// #include "cppfun/client/Client.hpp"
// #include "cppfun/packet/schema/MovementSchema.hpp"

// template <class T> Packet<T>::Packet(MessageHeader header) : m_header(header)
// {}

// template <class T> T &Packet<T>::read(PacketReader &reader) {
//   m_schema.decode(reader);
//   return m_schema;
// }

// template <class T> void Packet<T>::write(PacketWriter &writer) {
//   writer.writeU8(m_header);
//   m_schema.encode(writer);
// }

// template class Packet<SpawnSchema>;
// template class Packet<MovementSchema>;

// Packet<SpawnSchema> SPAWN_PACKET(MessageHeader::SPAWN);
// Packet<MovementSchema> MOVEMENT_PACKET(MessageHeader::MOVEMENT);