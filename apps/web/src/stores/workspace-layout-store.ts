import { create } from 'zustand'

interface WorkspaceLayoutState {
  agentOpen: boolean
  observationOpen: boolean
  bottomDataOpen: boolean
  toggleAgent: () => void
}

export const useWorkspaceLayoutStore = create<WorkspaceLayoutState>((set) => ({
  agentOpen: true,
  observationOpen: true,
  bottomDataOpen: true,
  toggleAgent: () => set((state) => ({ agentOpen: !state.agentOpen })),
}))
