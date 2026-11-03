/** Portable V3 wire contract. No engine, DOM, package install or application dependencies. */
export const UNIVERSAL_PROTOCOL_VERSION = 3         
export const UNIVERSAL_DOMAINS = [
  'mechanics',
  'electric',
  'magnetic',
  'circuit',
  'composite',
  'optics',
  'acoustics',
  'fluid',
  'thermal',
  'induction',
  'wave',
  'modern',
]         
                                                                
                                              
                               
                           
                                    
                                  
                        
                            
                       
                                        
                   
                         
                          
                             
                         
   
                        
                                     
                                           
                                     
                                             
 
const object = (value         )                                   =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const finite = (value         )                  =>
  typeof value === 'number' && Number.isFinite(value)

/** Prevent transfer/render of callbacks, non-finite facts, oversized or cyclic values. */
function plainData(value         )          {
  let nodes = 0
  const seen = new Set        ()
  const visit = (item         , depth        )          => {
    if (++nodes > 200000 || depth > 32) return false
    if (item === null || typeof item === 'boolean') return true
    if (typeof item === 'string') return item.length <= 131072
    if (typeof item === 'number') return Number.isFinite(item)
    if (typeof item !== 'object' || seen.has(item)) return false
    seen.add(item)
    const valid = Array.isArray(item)
      ? item.length <= 20000 && item.every(child => visit(child, depth + 1))
      : (Object.getPrototypeOf(item) === Object.prototype ||
          Object.getPrototypeOf(item) === null) &&
        Object.entries(item).every(([key, child]) => key.length <= 160 && visit(child, depth + 1))
    seen.delete(item)
    return valid
  }
  return visit(value, 0)
}

export function isUniversalSnapshot(
  value         ,
  expectedExperimentId         ,
)                                       {
  if (!object(value) || !plainData(value)) return false
  if (
    typeof value.experimentId !== 'string' ||
    !/^[a-z0-9][a-z0-9-]{0,79}$/.test(value.experimentId) ||
    (expectedExperimentId !== undefined && value.experimentId !== expectedExperimentId)
  )
    return false
  if (
    value.source !== 'platform-engine' ||
    !finite(value.revision) ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0
  )
    return false
  if (
    !UNIVERSAL_DOMAINS.includes(value.domain                   ) ||
    typeof value.title !== 'string' ||
    typeof value.ariaLabel !== 'string' ||
    !object(value.view) ||
    !Array.isArray(value.inspector)
  )
    return false
  if (
    !object(value.clock) ||
    !finite(value.clock.time) ||
    !finite(value.clock.total) ||
    value.clock.time < 0 ||
    value.clock.total < 0 ||
    typeof value.clock.running !== 'boolean' ||
    !finite(value.clock.rate) ||
    value.clock.rate <= 0
  )
    return false
  return (
    object(value.table) &&
    Array.isArray(value.charts) &&
    Array.isArray(value.verification) &&
    Array.isArray(value.events) &&
    Array.isArray(value.trajectoryTimes) &&
    value.trajectoryTimes.every(finite)
  )
}

                                       
     
                                                  
                      
              
                 
   
                                                    
                                                                         
                                                                                 
                                                                      
                                                               
                                                               
                                                       
const identifier = (value         )                  =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 160 &&
  !/[\u0000-\u001f\u007f]/.test(value)
export function isUniversalExperimentIntent(value         )                                     {
  if (!object(value) || value.protocolVersion !== 3) return false
  const exact = (fields                   ) =>
    Object.keys(value).length === fields.length + 2 &&
    Object.keys(value).every(
      key => key === 'type' || key === 'protocolVersion' || fields.includes(key),
    )
  switch (value.type) {
    case 'parameter/preview':
    case 'parameter/commit':
      return exact(['id', 'value']) && identifier(value.id) && finite(value.value)
    case 'parameter/cancel':
      return exact([])
    case 'choice/set':
      return exact(['id', 'value']) && identifier(value.id) && identifier(value.value)
    case 'observable/set':
      return (
        exact(['key', 'enabled']) && identifier(value.key) && typeof value.enabled === 'boolean'
      )
    case 'playback/running':
      return exact(['running']) && typeof value.running === 'boolean'
    case 'playback/rate':
      return exact(['rate']) && finite(value.rate) && value.rate > 0
    case 'playback/seek':
      return exact(['time']) && finite(value.time) && value.time >= 0
    default:
      return false
  }
}
