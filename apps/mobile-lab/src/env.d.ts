declare module '*.module.css' { const names: Record<string, string>; export default names }
declare module '*.css'
declare module 'virtual:lab-assets' {
  export const imageData: Readonly<Record<string, string>>
}
declare module 'virtual:lab-catalog' {
  export const catalog: import('./catalog/types.ts').ExperimentCatalog
}
declare const __LAB_TEST__: boolean
interface Window {
  PhysicsNative?: { postMessage(message: string): void }
  __physicsLab?: import('./runtime/client.ts').LabClient
  __labMetrics?: import('./shared/metrics.ts').MetricSnapshot
}
