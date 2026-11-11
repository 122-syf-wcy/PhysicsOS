import { readCheckpointEnvelope, type LabCheckpoint } from '../shared/checkpoint.ts'
import { LabError } from '../shared/protocol.ts'

export interface SavedScene { id: string; title: string; updatedAt: number; checkpoint: LabCheckpoint }
/** Browser-only opt-in persistence. Native account-scoped Room storage owns all APK saves. */
export class LocalScenes {
  private async database(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('physicsos-offline-lab-v1', 1)
      request.onupgradeneeded = () => { request.result.createObjectStore('scenes', { keyPath: 'id' }) }
      request.onerror = () => reject(new LabError('STORAGE_UNAVAILABLE', '本地存储无法打开。请导出 JSON 保存；不会把失败标记为已保存。'))
      request.onblocked = () => reject(new LabError('STORAGE_BLOCKED', '另一个实验页阻塞了本地存储，请关闭后重试。'))
      request.onsuccess = () => resolve(request.result)
    })
  }
  private async transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.database()
    try {
      return await new Promise<T>((resolve, reject) => {
        const transaction = db.transaction('scenes', mode)
        const request = action(transaction.objectStore('scenes'))
        transaction.oncomplete = () => resolve(request.result)
        transaction.onerror = transaction.onabort = () => reject(new LabError('STORAGE_FAILED', '存储失败或空间不足。请导出完整 JSON；没有丢弃撤销历史。'))
      })
    } finally { db.close() }
  }
  async save(checkpoint: LabCheckpoint): Promise<void> {
    readCheckpointEnvelope(checkpoint)
    await this.transaction('readwrite', store => store.put({ id: checkpoint.editing.instanceKey,
      title: checkpoint.scene.metadata.title || '未命名实验', updatedAt: Date.now(), checkpoint } satisfies SavedScene))
  }
  async list(): Promise<Omit<SavedScene, 'checkpoint'>[]> {
    // Do not eagerly retain complete histories in the React scene picker.
    const rows = await this.transaction('readonly', store => store.getAll() as IDBRequest<SavedScene[]>)
    return rows.map(({ checkpoint: _checkpoint, ...summary }) => summary).sort((a, b) => b.updatedAt - a.updatedAt)
  }
  async get(id: string): Promise<LabCheckpoint> {
    const row = await this.transaction('readonly', store => store.get(id) as IDBRequest<SavedScene | undefined>)
    if (row === undefined) throw new LabError('SCENE_MISSING', '这个本地存档已不存在。')
    return readCheckpointEnvelope(row.checkpoint)
  }
  async remove(id: string): Promise<void> { await this.transaction('readwrite', store => store.delete(id)) }
}
