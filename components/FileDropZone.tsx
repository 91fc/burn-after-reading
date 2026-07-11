'use client'

import { useRef, useState, useCallback } from 'react'

export function FileDropZone({
  onFile,
  selectedFile,
}: {
  onFile: (file: File | null) => void
  selectedFile: File | null
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragActive, setDragActive] = useState(false)

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragActive(false)
      const file = e.dataTransfer.files[0]
      if (file) onFile(file)
    },
    [onFile],
  )

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setDragActive(true)
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      className={`flex min-h-[120px] cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 transition ${
        dragActive
          ? 'border-brand-accent bg-brand-accent/10'
          : 'border-white/10 bg-brand-surface hover:border-white/20'
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0] ?? null
          onFile(file)
        }}
      />
      {selectedFile ? (
        <div className="text-center">
          <div className="mb-1 text-2xl">📎</div>
          <p className="text-sm font-medium">{selectedFile.name}</p>
          <p className="text-xs text-brand-muted">
            {(selectedFile.size / 1024).toFixed(1)} KB
          </p>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onFile(null)
            }}
            className="mt-2 text-xs text-brand-danger hover:underline"
          >
            移除
          </button>
        </div>
      ) : (
        <div className="text-center text-brand-muted">
          <div className="mb-1 text-2xl">📂</div>
          <p className="text-sm">拖拽文件到此处，或点击选择</p>
        </div>
      )}
    </div>
  )
}
