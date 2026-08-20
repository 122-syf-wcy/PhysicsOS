export function PhysicsMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="pos-mark" x1="4" y1="4" x2="28" y2="28">
          <stop stopColor="#76A5FF" />
          <stop offset="1" stopColor="#2563EB" />
        </linearGradient>
      </defs>
      <path
        d="M16 3 27 9.2v13.6L16 29 5 22.8V9.2L16 3Z"
        fill="url(#pos-mark)"
      />
      <path d="M16 8.2 22.6 12v8L16 23.8 9.4 20v-8L16 8.2Z" fill="#F7F9FC" />
      <path d="M16 12.4 19.4 14.4v4L16 20.4 12.6 18.4v-4L16 12.4Z" fill="#3B82F6" />
    </svg>
  )
}
