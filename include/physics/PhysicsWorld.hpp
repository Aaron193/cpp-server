#include <box2d/b2_world.h>

#include <memory>

class PhysicsWorld {
   public:
    PhysicsWorld() noexcept;

    void tick(double delta);

   private:
    std::unique_ptr<b2World> m_world;
};