import { BrowserRouter, Route, Routes } from 'react-router'
import { DesktopWorkspacePage } from '../pages/desktop-workspace-page.tsx'
import { HomePage } from '../pages/home-page.tsx'
import { PhysicsWorkspacePage } from '../pages/physics-workspace-page.tsx'
import { QuestionSpacePage } from '../pages/question-space-page.tsx'
import { PlaceholderPage } from './placeholder-page.tsx'
import { WebShell } from './web-shell.tsx'

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/desktop" element={<DesktopWorkspacePage />} />
        <Route element={<WebShell />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/lab" element={<PhysicsWorkspacePage />} />
          <Route path="/lab/:sceneId" element={<PhysicsWorkspacePage />} />
          <Route path="/questions" element={<QuestionSpacePage />} />
          <Route path="/questions/:questionId" element={<QuestionSpacePage />} />
          <Route
            path="/history"
            element={<PlaceholderPage title="学习记录" detail="后续接入 Learning Model，本阶段仅路由壳层。" />}
          />
          <Route
            path="/resources"
            element={<PlaceholderPage title="资源库" detail="后续接入内容服务，本阶段仅路由壳层。" />}
          />
          <Route
            path="/profile"
            element={<PlaceholderPage title="我的" detail="后续接入账号与权限，本阶段仅路由壳层。" />}
          />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
