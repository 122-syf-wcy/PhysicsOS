import type { WorkspaceSnapshot } from '../physics/workspace-runtime.ts'

/** Keep owned physics facts unchanged while existing lens benches use a lens-relative display origin. */
export function lensBenchSnapshot(snapshot: WorkspaceSnapshot): WorkspaceSnapshot | undefined {
  const view = snapshot.view
  const parameters = snapshot.inspector.flatMap(section => section.parameters ?? [])
  const value = (id: string) => parameters.find(parameter => parameter.id === id)?.value
  const focal = value('focal-length')
  const element = view.opticalElements?.[0]
  if (snapshot.domain !== 'optics' || view.opticalElements?.length !== 1 || element?.kind !== 'thin_lens'
    || !Number.isFinite(focal) || !(focal! > 0) || !['object-distance', 'screen-distance', 'object-height'].every(id => Number.isFinite(value(id)))
    || (view.opticalScreens?.length ?? 0) === 0) return undefined
  const offset = element.at.x
  const point = <T extends { readonly x: number }>(value: T): T => ({ ...value, x: value.x - offset })
  return { ...snapshot, view: { ...view, origin: point(view.origin),
    ...(view.opticalObjects === undefined ? {} : { opticalObjects: view.opticalObjects.map(item => ({ ...item, at: point(item.at) })) }),
    opticalElements: view.opticalElements.map(item => ({ ...item, at: point(item.at) })),
    ...(view.opticalScreens === undefined ? {} : { opticalScreens: view.opticalScreens.map(item => ({ ...item, at: point(item.at) })) }),
    ...(view.opticalImages === undefined ? {} : { opticalImages: view.opticalImages.map(item => ({ ...item, at: point(item.at) })) }),
    ...(view.opticalAxisMarks === undefined ? {} : { opticalAxisMarks: view.opticalAxisMarks.map(item => ({ ...item, at: point(item.at) })) }),
    ...(view.opticalRays === undefined ? {} : { opticalRays: view.opticalRays.map(item => ({ ...item, points: item.points.map(point),
      ...(item.extension === undefined ? {} : { extension: item.extension.map(point) }) })) }),
  } }
}
