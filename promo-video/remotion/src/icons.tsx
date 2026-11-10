/**
 * 小节图标：照搬项目自绘 SVG 体系的路径
 * （overlays/harness/files/packages/client/ui-physicsos/src/client/icons/physics-icons.tsx，24×24、currentColor、线性），
 * 不用 AI 生成图标。
 */
import React from 'react'

const Glyph: React.FC<{ size?: number; children: React.ReactNode }> = ({ size = 30, children }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
)

export const IconPhysicsLab = () => (
  <Glyph>
    <path d="M9 3h6" />
    <path d="M10 3v5.2L5.6 17.4A2.2 2.2 0 0 0 7.6 20.6h8.8a2.2 2.2 0 0 0 2-3.2L14 8.2V3" />
    <path d="M7.4 14h9.2" />
  </Glyph>
)

export const IconQuestionSheet = () => (
  <Glyph>
    <path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8z" />
    <path d="M14 3v3.5A1.5 1.5 0 0 0 15.5 8H19" />
    <path d="M8.5 12.5h7M8.5 16.5h4.5" />
  </Glyph>
)

export const IconChatBubble = () => (
  <Glyph>
    <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v7a2.5 2.5 0 0 1-2.5 2.5H9l-4.2 3.4A1 1 0 0 1 3.2 17.6V5.5" />
    <path d="M8 8.5h8M8 11.5h5" />
  </Glyph>
)

export const IconLibrary = () => (
  <Glyph>
    <path d="M12 6.4C10.4 5 8.1 4.4 4.6 4.4c-.4 0-.7.3-.7.7v12.6c0 .4.3.7.7.7 3.5 0 5.8.6 7.4 2 1.6-1.4 3.9-2 7.4-2 .4 0 .7-.3.7-.7V5.1c0-.4-.3-.7-.7-.7-3.5 0-5.8.6-7.4 2z" />
    <path d="M12 6.4v13.4" />
  </Glyph>
)
