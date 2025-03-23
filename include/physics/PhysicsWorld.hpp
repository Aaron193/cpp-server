#include <box2d/b2_world.h>

class PhysicsWorld {
   public:
    PhysicsWorld() noexcept;
    ~PhysicsWorld();

    void tick(double delta);

   private:
    b2World* m_world;
};