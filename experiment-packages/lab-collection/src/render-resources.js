// GPU resources belong to a display/part, not to a frame. Borrowed material
// maps (including scene.environment) are deliberately not disposed with a part.
const disposed = new WeakSet()

export function disposeOnce(resource) {
  if (!resource || typeof resource.dispose !== 'function' || disposed.has(resource)) return
  disposed.add(resource)
  resource.dispose()
}

export function createResourceOwner() {
  const resources = new Set()
  let closed = false
  return {
    own(resource) {
      if (!resource) return resource
      if (closed) disposeOnce(resource)
      else resources.add(resource)
      return resource
    },
    release(resource) {
      resources.delete(resource)
      disposeOnce(resource)
    },
    dispose() {
      if (closed) return
      closed = true
      for (const resource of resources) disposeOnce(resource)
      resources.clear()
    },
    get size() { return resources.size },
    get disposed() { return closed },
  }
}

/** A callback from an obsolete load/context/display must never install an asset. */
export function createAssetFence(owner = createResourceOwner()) {
  let generation = 0, closed = false
  return {
    own(resource) { return owner.own(resource) },
    release(resource) { owner.release(resource) },
    ticket() { return generation },
    invalidate() { if (!closed) generation++ },
    current(ticket) { return !closed && ticket === generation },
    accept(ticket, resource, install) {
      if (closed || ticket !== generation) {
        owner.release(resource)
        return false
      }
      owner.own(resource)
      install(resource)
      return true
    },
    dispose() {
      if (closed) return
      closed = true; generation++
      owner.dispose()
    },
    get generation() { return generation },
    get disposed() { return closed },
  }
}

export function ownObjectResources(owner, object, textures = []) {
  object.traverse(child => {
    if (child.geometry) owner.own(child.geometry)
    for (const material of Array.isArray(child.material) ? child.material : [child.material]) if (material) owner.own(material)
  })
  for (const texture of textures) owner.own(texture)
  return object
}

export function disposeObjectResources(object) {
  const owner = createResourceOwner()
  ownObjectResources(owner, object)
  owner.dispose()
}
