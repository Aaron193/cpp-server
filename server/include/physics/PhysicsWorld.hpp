#include <box2d/b2_world.h>

#include <entt/entity/fwd.hpp>
#include <memory>
#include <vector>

class QueryNetworkedEntities : public b2QueryCallback {
   public:
    std::vector<entt::entity> entities;
    void Clear();
    bool ReportFixture(b2Fixture* fixture) override;
};

class PhysicsWorld {
   public:
    PhysicsWorld() noexcept;

    void tick(double delta);

    std::unique_ptr<b2World> m_world;

    QueryNetworkedEntities* m_queryCallback;

   private:
};
