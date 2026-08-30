#include "physics/PhysicsWorld.hpp"

#include <Jolt/Jolt.h>
#include <Jolt/Core/Factory.h>
#include <Jolt/Core/JobSystemThreadPool.h>
#include <Jolt/Core/TempAllocator.h>
#include <Jolt/RegisterTypes.h>
#include <Jolt/Physics/Body/BodyCreationSettings.h>
#include <Jolt/Physics/Character/CharacterVirtual.h>
#include <Jolt/Physics/Collision/Shape/CapsuleShape.h>
#include <Jolt/Physics/Collision/Shape/MeshShape.h>
#include <Jolt/Physics/Collision/Shape/RotatedTranslatedShape.h>
#include <Jolt/Physics/Collision/NarrowPhaseQuery.h>
#include <Jolt/Physics/Collision/RayCast.h>
#include <Jolt/Physics/Collision/CastResult.h>
#include <Jolt/Physics/Body/BodyLock.h>
#include <Jolt/Physics/PhysicsSystem.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <mutex>
#include <string>
#include <stdexcept>
#include <thread>
#include <unordered_map>
#include <glm/geometric.hpp>

#include "physics/CollisionLayers.hpp"

namespace {
namespace Layers {
constexpr JPH::ObjectLayer StaticWorld = 0;
constexpr JPH::ObjectLayer Character = 1;
constexpr JPH::ObjectLayer DynamicProp = 2;
constexpr JPH::ObjectLayer Projectile = 3;
constexpr JPH::ObjectLayer Trigger = 4;
constexpr JPH::ObjectLayer QueryOnlyHitbox = 5;
}  // namespace Layers
namespace Broad {
constexpr JPH::BroadPhaseLayer Static{0};
constexpr JPH::BroadPhaseLayer Moving{1};
constexpr JPH::BroadPhaseLayer Sensor{2};
constexpr std::uint32_t Count = 3;
}  // namespace Broad

CollisionLayers::Layer logical(JPH::ObjectLayer layer) {
    return static_cast<CollisionLayers::Layer>(layer);
}

class BroadPhaseInterface final : public JPH::BroadPhaseLayerInterface {
   public:
    std::uint32_t GetNumBroadPhaseLayers() const override { return Broad::Count; }
    JPH::BroadPhaseLayer GetBroadPhaseLayer(JPH::ObjectLayer layer) const override {
        if (layer == Layers::StaticWorld) return Broad::Static;
        if (layer == Layers::Trigger || layer == Layers::QueryOnlyHitbox) return Broad::Sensor;
        return Broad::Moving;
    }
#if defined(JPH_EXTERNAL_PROFILE) || defined(JPH_PROFILE_ENABLED)
    const char* GetBroadPhaseLayerName(JPH::BroadPhaseLayer layer) const override {
        if (layer == Broad::Static) return "Static";
        if (layer == Broad::Moving) return "Moving";
        return "Sensor";
    }
#endif
};

class ObjectVsBroadFilter final : public JPH::ObjectVsBroadPhaseLayerFilter {
   public:
    bool ShouldCollide(JPH::ObjectLayer layer, JPH::BroadPhaseLayer broad) const override {
        const auto value = logical(layer);
        if (broad == Broad::Static)
            return CollisionLayers::shouldCollide(value, CollisionLayers::Layer::StaticWorld);
        if (broad == Broad::Sensor)
            return CollisionLayers::shouldCollide(value, CollisionLayers::Layer::Trigger);
        return value != CollisionLayers::Layer::StaticWorld &&
               value != CollisionLayers::Layer::QueryOnlyHitbox;
    }
};

class ObjectPairFilter final : public JPH::ObjectLayerPairFilter {
   public:
    bool ShouldCollide(JPH::ObjectLayer a, JPH::ObjectLayer b) const override {
        return CollisionLayers::shouldCollide(logical(a), logical(b));
    }
};

class JoltRuntime {
   public:
    JoltRuntime() {
        std::lock_guard<std::mutex> lock(mutex());
        if (references()++ == 0) {
            JPH::RegisterDefaultAllocator();
            JPH::Factory::sInstance = new JPH::Factory();
            JPH::RegisterTypes();
        }
    }
    ~JoltRuntime() {
        std::lock_guard<std::mutex> lock(mutex());
        if (--references() == 0) {
            JPH::UnregisterTypes();
            delete JPH::Factory::sInstance;
            JPH::Factory::sInstance = nullptr;
        }
    }
   private:
    static std::mutex& mutex() { static std::mutex value; return value; }
    static std::uint32_t& references() { static std::uint32_t value = 0; return value; }
};

JPH::Vec3 toJolt(const glm::vec3& value) { return {value.x, value.y, value.z}; }
template <typename Vector>
glm::vec3 fromJolt(const Vector& value) {
    return {static_cast<float>(value.GetX()), static_cast<float>(value.GetY()),
            static_cast<float>(value.GetZ())};
}
}  // namespace

struct PhysicsWorld::Impl {
    JoltRuntime runtime;
    BroadPhaseInterface broadPhaseInterface;
    ObjectVsBroadFilter objectVsBroadFilter;
    ObjectPairFilter objectPairFilter;
    JPH::TempAllocatorImpl allocator{16U * 1024U * 1024U};
    JPH::JobSystemThreadPool jobs{JPH::cMaxPhysicsJobs, JPH::cMaxPhysicsBarriers,
        std::max(0, static_cast<int>(std::thread::hardware_concurrency()) - 1)};
    JPH::PhysicsSystem system;
    struct CharacterEntry {
        JPH::Ref<JPH::CharacterVirtual> character;
        CharacterConfig config;
        std::array<JPH::RefConst<JPH::Shape>, 3> stanceShapes;
        CharacterStance stance = CharacterStance::Standing;
    };
    std::unordered_map<CharacterId, CharacterEntry> characters;
    std::unordered_map<BodyId, JPH::BodyID> bodies;
    CharacterId nextCharacter = 1;
    BodyId nextBody = 1;

    Impl() {
        system.Init(4096, 0, 8192, 2048, broadPhaseInterface,
                    objectVsBroadFilter, objectPairFilter);
        system.SetGravity({0.0F, -9.81F, 0.0F});
    }
    ~Impl() {
        characters.clear();
        auto& interface = system.GetBodyInterface();
        for (const auto& entry : bodies) {
            interface.RemoveBody(entry.second);
            interface.DestroyBody(entry.second);
        }
    }
    CharacterEntry& entry(CharacterId id) {
        const auto found = characters.find(id);
        if (found == characters.end()) throw std::out_of_range("unknown character adapter id");
        return found->second;
    }
    const CharacterEntry& entry(CharacterId id) const {
        const auto found = characters.find(id);
        if (found == characters.end()) throw std::out_of_range("unknown character adapter id");
        return found->second;
    }
    JPH::CharacterVirtual& character(CharacterId id) {
        return *entry(id).character;
    }
    const JPH::CharacterVirtual& character(CharacterId id) const {
        return *entry(id).character;
    }
};

PhysicsWorld::PhysicsWorld() : impl_(std::make_unique<Impl>()) {}
PhysicsWorld::~PhysicsWorld() = default;
PhysicsWorld::PhysicsWorld(PhysicsWorld&&) noexcept = default;
PhysicsWorld& PhysicsWorld::operator=(PhysicsWorld&&) noexcept = default;

PhysicsWorld::BodyId PhysicsWorld::addStaticCollision(const CollisionMesh3D& mesh) {
    if (mesh.vertices.empty() || mesh.indices.empty() || mesh.indices.size() % 3 != 0)
        throw std::invalid_argument("collision mesh must contain complete triangles");
    for (const auto& vertex : mesh.vertices) {
        if (!(std::isfinite(vertex.x) && std::isfinite(vertex.y) &&
              std::isfinite(vertex.z)))
            throw std::invalid_argument("collision mesh contains a non-finite vertex");
    }
    for (const auto index : mesh.indices) {
        if (index >= mesh.vertices.size())
            throw std::invalid_argument("collision mesh index is out of range");
    }
    JPH::VertexList vertices;
    vertices.reserve(mesh.vertices.size());
    for (const auto& vertex : mesh.vertices) vertices.emplace_back(vertex.x, vertex.y, vertex.z);
    JPH::IndexedTriangleList triangles;
    triangles.reserve(mesh.indices.size() / 3);
    for (std::size_t i = 0; i < mesh.indices.size(); i += 3)
        triangles.emplace_back(mesh.indices[i], mesh.indices[i + 1], mesh.indices[i + 2]);
    JPH::MeshShapeSettings settings(std::move(vertices), std::move(triangles));
    const auto shape = settings.Create();
    if (shape.HasError()) {
        const auto& error = shape.GetError();
        throw std::runtime_error("Jolt rejected collision mesh: " +
                                 std::string(error.data(), error.size()));
    }
    JPH::BodyCreationSettings bodySettings(shape.Get(), JPH::RVec3::sZero(),
        JPH::Quat::sIdentity(), JPH::EMotionType::Static, Layers::StaticWorld);
    const auto native = impl_->system.GetBodyInterface().CreateAndAddBody(
        bodySettings, JPH::EActivation::DontActivate);
    if (native.IsInvalid()) throw std::runtime_error("Jolt could not create static collision body");
    const BodyId id = impl_->nextBody++;
    impl_->bodies.emplace(id, native);
    return id;
}

void PhysicsWorld::removeBody(BodyId body) {
    const auto found = impl_->bodies.find(body);
    if (found == impl_->bodies.end()) return;
    auto& interface = impl_->system.GetBodyInterface();
    interface.RemoveBody(found->second);
    interface.DestroyBody(found->second);
    impl_->bodies.erase(found);
}

PhysicsWorld::CharacterId PhysicsWorld::createCharacter(
    const CharacterConfig& config, const glm::vec3& position) {
    if (!(std::isfinite(config.radius) && config.radius > 0.0F &&
          std::isfinite(config.halfHeight) && config.halfHeight >= 0.0F &&
          std::isfinite(config.maxSlopeRadians) && config.maxSlopeRadians >= 0.0F &&
          config.maxSlopeRadians <= 0.5F * JPH::JPH_PI &&
          std::isfinite(config.stepHeight) && config.stepHeight >= 0.0F &&
          std::isfinite(config.stickToFloorDistance) &&
          config.stickToFloorDistance >= 0.0F &&
          std::isfinite(config.groundAcceleration) &&
          config.groundAcceleration > 0.0F &&
          std::isfinite(config.airAcceleration) &&
          config.airAcceleration > 0.0F && std::isfinite(config.airControl) &&
          config.airControl >= 0.0F && config.airControl <= 1.0F &&
          std::isfinite(config.jumpSpeed) && config.jumpSpeed > 0.0F &&
          std::isfinite(config.gravity) && config.gravity > 0.0F &&
          std::isfinite(config.terminalVelocity) &&
          config.terminalVelocity > 0.0F &&
          std::isfinite(config.mass) && config.mass > 0.0F))
        throw std::invalid_argument("invalid character capsule configuration");
    if (!(std::isfinite(config.crouchRadius) && config.crouchRadius > 0.0F &&
          std::isfinite(config.crouchHalfHeight) && config.crouchHalfHeight >= 0.0F &&
          std::isfinite(config.proneRadius) && config.proneRadius > 0.0F &&
          std::isfinite(config.proneHalfHeight) && config.proneHalfHeight >= 0.0F))
        throw std::invalid_argument("invalid alternate character capsule configuration");
    const auto makeShape = [](float halfHeight, float radius) {
        const auto capsule = JPH::RefConst<JPH::Shape>(new JPH::CapsuleShape(halfHeight, radius));
        return JPH::RefConst<JPH::Shape>(new JPH::RotatedTranslatedShape(
            {0.0F, halfHeight + radius, 0.0F}, JPH::Quat::sIdentity(), capsule));
    };
    std::array<JPH::RefConst<JPH::Shape>, 3> shapes{
        makeShape(config.halfHeight, config.radius),
        makeShape(config.crouchHalfHeight, config.crouchRadius),
        makeShape(config.proneHalfHeight, config.proneRadius)};
    JPH::CharacterVirtualSettings settings;
    settings.mShape = shapes[0];
    settings.mSupportingVolume = JPH::Plane(JPH::Vec3::sAxisY(), -config.radius);
    settings.mMaxSlopeAngle = config.maxSlopeRadians;
    settings.mMass = config.mass;
    settings.mUp = JPH::Vec3::sAxisY();
    auto character = new JPH::CharacterVirtual(&settings, toJolt(position),
        JPH::Quat::sIdentity(), 0, &impl_->system);
    const CharacterId id = impl_->nextCharacter++;
    impl_->characters.emplace(id, Impl::CharacterEntry{character, config, std::move(shapes), CharacterStance::Standing});
    return id;
}

void PhysicsWorld::destroyCharacter(CharacterId id) { impl_->characters.erase(id); }
void PhysicsWorld::setCharacterVelocity(CharacterId id, const glm::vec3& value) {
    impl_->character(id).SetLinearVelocity(toJolt(value));
}
void PhysicsWorld::setCharacterPosition(CharacterId id, const glm::vec3& value) {
    auto& character = impl_->character(id);
    character.SetPosition(toJolt(value));
    character.RefreshContacts(
        impl_->system.GetDefaultBroadPhaseLayerFilter(Layers::Character),
        impl_->system.GetDefaultLayerFilter(Layers::Character), {}, {}, impl_->allocator);
}
bool PhysicsWorld::setCharacterStance(CharacterId id, CharacterStance stance) {
    auto& entry = impl_->entry(id);
    if (entry.stance == stance) return true;
    const auto index = static_cast<std::size_t>(stance);
    if (index >= entry.stanceShapes.size()) return false;
    const bool accepted = entry.character->SetShape(
        entry.stanceShapes[index], 0.04F,
        impl_->system.GetDefaultBroadPhaseLayerFilter(Layers::Character),
        impl_->system.GetDefaultLayerFilter(Layers::Character), {}, {},
        impl_->allocator);
    if (accepted) entry.stance = stance;
    return accepted;
}
PhysicsWorld::CharacterState PhysicsWorld::characterState(CharacterId id) const {
    const auto& character = impl_->character(id);
    return {fromJolt(character.GetPosition()), fromJolt(character.GetLinearVelocity()),
        character.GetGroundState() == JPH::CharacterBase::EGroundState::OnGround};
}

void PhysicsWorld::updateCharacter(CharacterId id, float delta,
                                   const glm::vec3& desired, bool jump) {
    if (!(delta > 0.0F) || !std::isfinite(delta)) return;
    auto& character = impl_->character(id);
    const auto& config = impl_->entry(id).config;
    const glm::vec3 gravity{0.0F, -config.gravity, 0.0F};
    const JPH::Vec3 joltGravity = toJolt(gravity);
    JPH::CharacterVirtual::ExtendedUpdateSettings settings;
    settings.mStickToFloorStepDown =
        {0.0F, -config.stickToFloorDistance, 0.0F};
    settings.mWalkStairsStepUp = {0.0F, config.stepHeight, 0.0F};
    constexpr float fixed = 1.0F / 60.0F;
    float remaining = std::min(delta, 0.25F);
    bool jumpPending = jump;
    while (remaining > 0.0F) {
        const float interval = std::min(remaining, fixed);
        const auto current = fromJolt(character.GetLinearVelocity());
        const auto groundVelocity = fromJolt(character.GetGroundVelocity());
        const bool grounded = character.GetGroundState() ==
                              JPH::CharacterBase::EGroundState::OnGround;
        const bool movingTowardGround = current.y - groundVelocity.y < 0.1F;
        const float acceleration = grounded
                                       ? config.groundAcceleration
                                       : config.airAcceleration * config.airControl;
        const float maxDelta = acceleration * interval;
        const auto approach = [maxDelta](float value, float target) {
            return value < target ? std::min(value + maxDelta, target)
                                  : std::max(value - maxDelta, target);
        };
        glm::vec3 velocity{approach(current.x, desired.x), current.y,
                           approach(current.z, desired.z)};
        if (grounded && movingTowardGround) {
            velocity.y = groundVelocity.y;
            if (jumpPending) velocity.y += config.jumpSpeed;
        }
        velocity += gravity * interval;
        velocity.y = std::max(velocity.y, -config.terminalVelocity);
        character.SetLinearVelocity(toJolt(velocity));
        character.ExtendedUpdate(
            interval, joltGravity, settings,
            impl_->system.GetDefaultBroadPhaseLayerFilter(Layers::Character),
            impl_->system.GetDefaultLayerFilter(Layers::Character), {}, {},
            impl_->allocator);
        jumpPending = false;
        remaining -= interval;
    }
}

bool PhysicsWorld::staticRayBlocked(const glm::vec3& from,
                                    const glm::vec3& to) const {
    const glm::vec3 direction = to - from;
    if (!(std::isfinite(direction.x) && std::isfinite(direction.y) &&
          std::isfinite(direction.z)) || glm::dot(direction, direction) < 1.0e-8F)
        return false;
    JPH::RayCastResult hit;
    const JPH::RRayCast ray(toJolt(from), toJolt(direction));
    return impl_->system.GetNarrowPhaseQuery().CastRay(
        ray, hit, {}, JPH::SpecifiedObjectLayerFilter(Layers::StaticWorld));
}

std::optional<PhysicsWorld::StaticRayHit> PhysicsWorld::castStaticRay(
    const glm::vec3& origin, const glm::vec3& direction,
    float maxDistance) const {
    if (!(maxDistance > 0.0F) || !std::isfinite(maxDistance) ||
        std::abs(glm::length(direction) - 1.0F) > 1.0e-3F)
        return std::nullopt;
    const glm::vec3 displacement = direction * maxDistance;
    const JPH::RRayCast ray(toJolt(origin), toJolt(displacement));
    JPH::RayCastResult hit;
    if (!impl_->system.GetNarrowPhaseQuery().CastRay(
            ray, hit, {},
            JPH::SpecifiedObjectLayerFilter(Layers::StaticWorld)))
        return std::nullopt;
    const glm::vec3 position = origin + displacement * hit.mFraction;
    glm::vec3 normal{-direction.x, -direction.y, -direction.z};
    JPH::BodyLockRead lock(impl_->system.GetBodyLockInterface(), hit.mBodyID);
    if (lock.Succeeded()) {
        normal = fromJolt(lock.GetBody().GetWorldSpaceSurfaceNormal(
            hit.mSubShapeID2, toJolt(position)));
    }
    return StaticRayHit{maxDistance * hit.mFraction, position, normal};
}

std::optional<glm::vec3> PhysicsWorld::findMantleTarget(
    const glm::vec3& feet, float yaw, float minHeight, float maxHeight,
    float reach, float radius, float standingHeight) const {
    if (!(minHeight > 0.0F && maxHeight > minHeight && reach > 0.0F &&
          radius > 0.0F && standingHeight > 0.0F)) return std::nullopt;
    const glm::vec3 forward{std::sin(yaw), 0.0F, -std::cos(yaw)};
    const glm::vec3 right{-forward.z, 0.0F, forward.x};
    std::optional<StaticRayHit> obstacle;
    for (const float lateral : {0.0F, -0.6F * radius, 0.6F * radius}) {
        const auto hit = castStaticRay(feet + glm::vec3{0.0F, minHeight, 0.0F} + right * lateral,
                                       forward, reach);
        if (hit && std::abs(hit->normal.y) < 0.55F &&
            (!obstacle || hit->distance < obstacle->distance)) obstacle = hit;
    }
    if (!obstacle) return std::nullopt;
    const glm::vec3 beyond = obstacle->position + forward * (radius + 0.08F);
    const auto top = castStaticRay(
        {beyond.x, feet.y + maxHeight + 0.08F, beyond.z},
        {0.0F, -1.0F, 0.0F}, maxHeight - minHeight + 0.16F);
    if (!top || top->normal.y < 0.65F || top->position.y - feet.y < minHeight ||
        top->position.y - feet.y > maxHeight) return std::nullopt;
    const glm::vec3 target{beyond.x, top->position.y + 0.025F, beyond.z};
    for (const glm::vec3 offset : {glm::vec3{0.0F}, right * radius, -right * radius,
                                   forward * radius, -forward * radius}) {
        if (staticRayBlocked(target + offset + glm::vec3{0.0F, 0.05F, 0.0F},
                             target + offset + glm::vec3{0.0F, standingHeight, 0.0F}))
            return std::nullopt;
    }
    const float pathHeight = maxHeight + 0.15F;
    if (staticRayBlocked(feet + glm::vec3{0.0F, pathHeight, 0.0F},
                         target + glm::vec3{0.0F, pathHeight, 0.0F}))
        return std::nullopt;
    return target;
}

void PhysicsWorld::step(float delta) {
    if (!(delta > 0.0F) || !std::isfinite(delta)) return;
    constexpr float fixed = 1.0F / 60.0F;
    float remaining = std::min(delta, 0.25F);
    while (remaining > 0.0F) {
        const float interval = std::min(remaining, fixed);
        impl_->system.Update(interval, 1, &impl_->allocator, &impl_->jobs);
        remaining -= interval;
    }
}
