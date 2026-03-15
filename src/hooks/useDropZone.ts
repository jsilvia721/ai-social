"use client";

import { useState, useCallback, type DragEvent } from "react";

export interface UseDropZoneOptions {
  /** Called with the dropped files. */
  onDrop: (files: File[]) => void;
  /** Whether the drop zone is disabled (e.g., while uploading). */
  disabled?: boolean;
}

/** Drag-and-drop file upload hook. */
export function useDropZone({ onDrop, disabled = false }: UseDropZoneOptions) {
  const [dragCounter, setDragCounter] = useState(0);

  const handleDragEnter = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (disabled) return;
      setDragCounter((c) => c + 1);
    },
    [disabled]
  );

  const handleDragOver = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    },
    []
  );

  const handleDragLeave = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (disabled) return;
      setDragCounter((c) => Math.max(0, c - 1));
    },
    [disabled]
  );

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragCounter(0);
      if (disabled) return;

      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length > 0) {
        onDrop(files);
      }
    },
    [disabled, onDrop]
  );

  return {
    isDragOver: dragCounter > 0,
    dropZoneProps: {
      onDragEnter: handleDragEnter,
      onDragOver: handleDragOver,
      onDragLeave: handleDragLeave,
      onDrop: handleDrop,
    },
  };
}
