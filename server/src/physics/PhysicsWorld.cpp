#include "physics/PhysicsWorld.hpp"

#include <box2d/b2_body.h>
#include <box2d/b2_collision.h>
#include <box2d/b2_contact.h>
#include <box2d/b2_fixture.h>
#include <box2d/b2_world.h>

#include "GameServer.hpp"
#include "ecs/EntityManager.hpp"
#include "ecs/components.hpp"

PhysicsWorld::PhysicsWorld(GameServer& gameServer)
    : m_world(std::make_unique<b2World>(b2Vec2(0.0f, 0.0f))),
      m_gameServer(gameServer),
      m_contactListener(new ContactListener(gameServer)),
      m_QueryNetworkedEntities(new QueryNetworkedEntities(gameServer)),
      m_queryBodies(new QueryBodies(gameServer)) {
    m_world->SetContactListener(m_contactListener);
};

void PhysicsWorld::tick(double delta) { m_world->Step(delta, 8, 3); }

// ======== QueryNetworkedEntities ========
QueryNetworkedEntities::QueryNetworkedEntities(GameServer& gameServer)
    : m_gameServer(gameServer) {}

bool QueryNetworkedEntities::ReportFixture(b2Fixture* fixture) {
    b2Body* body = fixture->GetBody();

    EntityBodyUserData* userData =
        reinterpret_cast<EntityBodyUserData*>(body->GetUserData().pointer);

    auto& reg = m_gameServer.m_entityManager.getRegistry();

    if (reg.all_of<Components::Networked>(userData->entity)) {
        entities.push_back(userData->entity);
    }

    return true;
}

void QueryNetworkedEntities::Clear() { entities.clear(); }

// ======== QueryBodies ========
QueryBodies::QueryBodies(GameServer& gameServer) : m_gameServer(gameServer) {}

bool QueryBodies::ReportFixture(b2Fixture* fixture) {
    b2Body* body = fixture->GetBody();

    if (body && body->GetUserData().pointer) {
        EntityBodyUserData* userData =
            reinterpret_cast<EntityBodyUserData*>(body->GetUserData().pointer);

        entt::registry& reg = m_gameServer.m_entityManager.getRegistry();
        if (reg.valid(userData->entity)) {
            entities.push_back(userData->entity);
        }
    }

    return true;
}

void QueryBodies::Clear() { entities.clear(); }

// ======== ContactListener ========

ContactListener::ContactListener(GameServer& gameServer)
    : m_gameServer(gameServer) {}

std::optional<std::pair<entt::entity, entt::entity>>
ContactListener::matchEntities(entt::entity entityA, entt::entity entityB,
                               EntityTypes expectedA, EntityTypes expectedB) {
    entt::registry& reg = m_gameServer.m_entityManager.getRegistry();

    assert(reg.all_of<Components::EntityBase>(entityA));
    assert(reg.all_of<Components::EntityBase>(entityB));

    EntityTypes typeA = reg.get<Components::EntityBase>(entityA).type;
    EntityTypes typeB = reg.get<Components::EntityBase>(entityB).type;

    if (typeA == expectedA && typeB == expectedB) {
        return std::make_pair(entityA, entityB);
    } else if (typeA == expectedB && typeB == expectedA) {
        return std::make_pair(entityB, entityA);
    }
    return std::nullopt;
}

void ContactListener::BeginContact(b2Contact* contact) {
    // b2Fixture* fixtureA = contact->GetFixtureA();
    // b2Fixture* fixtureB = contact->GetFixtureB();

    // entt::entity entityA = reinterpret_cast<EntityBodyUserData*>(
    //                            fixtureA->GetBody()->GetUserData().pointer)
    //                            ->entity;
    // entt::entity entityB = reinterpret_cast<EntityBodyUserData*>(
    //                            fixtureB->GetBody()->GetUserData().pointer)
    //                            ->entity;

    // if (auto match = matchEntities(entityA, entityB, EntityTypes::PLAYER,
    //                                EntityTypes::HITBOX)) {
    //     entt::entity player = match->first;
    //     entt::entity hitbox = match->second;

    //     std::cout << "Player hitbox contact: "
    //               << "Player: " << static_cast<uint32_t>(player)
    //               << ", Hitbox: " << static_cast<uint32_t>(hitbox) <<
    //               std::endl;
    // }
}

void ContactListener::EndContact(b2Contact* contact) {
    // b2Fixture* fixtureA = contact->GetFixtureA();
    // b2Fixture* fixtureB = contact->GetFixtureB();

    // entt::entity entityA = reinterpret_cast<EntityBodyUserData*>(
    //                            fixtureA->GetBody()->GetUserData().pointer)
    //                            ->entity;
    // entt::entity entityB = reinterpret_cast<EntityBodyUserData*>(
    //                            fixtureB->GetBody()->GetUserData().pointer)
    //                            ->entity;

    // entt::registry& reg = m_gameServer.m_entityManager.getRegistry();

    // Components::Type& typeA = reg.get<Components::Type>(entityA);
    // Components::Type& typeB = reg.get<Components::Type>(entityB);
}

void ContactListener::PreSolve(b2Contact* contact,
                               const b2Manifold* oldManifold) {
    // b2Fixture* fixtureA = contact->GetFixtureA();
    // b2Fixture* fixtureB = contact->GetFixtureB();

    // entt::entity entityA = reinterpret_cast<EntityBodyUserData*>(
    //                            fixtureA->GetBody()->GetUserData().pointer)
    //                            ->entity;
    // entt::entity entityB = reinterpret_cast<EntityBodyUserData*>(
    //                            fixtureB->GetBody()->GetUserData().pointer)
    //                            ->entity;

    // if (auto match = matchEntities(entityA, entityB, EntityTypes::PLAYER,
    //                                EntityTypes::HITBOX)) {
    //     entt::entity player = match->first;
    //     entt::entity hitbox = match->second;

    //     std::cout << "PRESOLVE: Player hitbox contact: "
    //               << "Player: " << static_cast<uint32_t>(player)
    //               << ", Hitbox: " << static_cast<uint32_t>(hitbox) <<
    //               std::endl;
    // }
}