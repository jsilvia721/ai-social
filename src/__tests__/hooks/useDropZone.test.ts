/**
 * @jest-environment jsdom
 */
import { renderHook, act } from "@testing-library/react";
import { useDropZone } from "@/hooks/useDropZone";
import type { DragEvent } from "react";

function createDragEvent(files: File[] = []): DragEvent {
  return {
    preventDefault: jest.fn(),
    stopPropagation: jest.fn(),
    dataTransfer: { files } as unknown as DataTransfer,
  } as unknown as DragEvent;
}

describe("useDropZone", () => {
  it("starts with isDragOver false", () => {
    const { result } = renderHook(() =>
      useDropZone({ onDrop: jest.fn() })
    );
    expect(result.current.isDragOver).toBe(false);
  });

  it("sets isDragOver true on dragEnter and false on dragLeave", () => {
    const { result } = renderHook(() =>
      useDropZone({ onDrop: jest.fn() })
    );

    act(() => {
      result.current.dropZoneProps.onDragEnter(createDragEvent());
    });
    expect(result.current.isDragOver).toBe(true);

    act(() => {
      result.current.dropZoneProps.onDragLeave(createDragEvent());
    });
    expect(result.current.isDragOver).toBe(false);
  });

  it("handles nested drag enter/leave (child elements)", () => {
    const { result } = renderHook(() =>
      useDropZone({ onDrop: jest.fn() })
    );

    // Enter parent
    act(() => {
      result.current.dropZoneProps.onDragEnter(createDragEvent());
    });
    // Enter child
    act(() => {
      result.current.dropZoneProps.onDragEnter(createDragEvent());
    });
    expect(result.current.isDragOver).toBe(true);

    // Leave child
    act(() => {
      result.current.dropZoneProps.onDragLeave(createDragEvent());
    });
    // Still over parent
    expect(result.current.isDragOver).toBe(true);

    // Leave parent
    act(() => {
      result.current.dropZoneProps.onDragLeave(createDragEvent());
    });
    expect(result.current.isDragOver).toBe(false);
  });

  it("calls onDrop with files and resets isDragOver on drop", () => {
    const onDrop = jest.fn();
    const { result } = renderHook(() => useDropZone({ onDrop }));

    const file = new File(["hello"], "test.png", { type: "image/png" });

    act(() => {
      result.current.dropZoneProps.onDragEnter(createDragEvent());
    });
    expect(result.current.isDragOver).toBe(true);

    act(() => {
      result.current.dropZoneProps.onDrop(createDragEvent([file]));
    });

    expect(onDrop).toHaveBeenCalledWith([file]);
    expect(result.current.isDragOver).toBe(false);
  });

  it("does not call onDrop when no files are dropped", () => {
    const onDrop = jest.fn();
    const { result } = renderHook(() => useDropZone({ onDrop }));

    act(() => {
      result.current.dropZoneProps.onDrop(createDragEvent([]));
    });

    expect(onDrop).not.toHaveBeenCalled();
  });

  it("prevents default and stops propagation on all events", () => {
    const { result } = renderHook(() =>
      useDropZone({ onDrop: jest.fn() })
    );

    const events = [
      createDragEvent(),
      createDragEvent(),
      createDragEvent(),
      createDragEvent(),
    ];

    act(() => {
      result.current.dropZoneProps.onDragEnter(events[0]);
      result.current.dropZoneProps.onDragOver(events[1]);
      result.current.dropZoneProps.onDragLeave(events[2]);
      result.current.dropZoneProps.onDrop(events[3]);
    });

    for (const event of events) {
      expect(event.preventDefault).toHaveBeenCalled();
      expect(event.stopPropagation).toHaveBeenCalled();
    }
  });

  it("ignores events when disabled", () => {
    const onDrop = jest.fn();
    const { result } = renderHook(() =>
      useDropZone({ onDrop, disabled: true })
    );

    const file = new File(["hello"], "test.png", { type: "image/png" });

    act(() => {
      result.current.dropZoneProps.onDragEnter(createDragEvent());
    });
    expect(result.current.isDragOver).toBe(false);

    act(() => {
      result.current.dropZoneProps.onDrop(createDragEvent([file]));
    });
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("still prevents default when disabled (to avoid browser opening the file)", () => {
    const { result } = renderHook(() =>
      useDropZone({ onDrop: jest.fn(), disabled: true })
    );

    const event = createDragEvent();
    act(() => {
      result.current.dropZoneProps.onDragOver(event);
    });
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it("does not let dragCounter go below zero", () => {
    const { result } = renderHook(() =>
      useDropZone({ onDrop: jest.fn() })
    );

    // Extra dragLeave without dragEnter
    act(() => {
      result.current.dropZoneProps.onDragLeave(createDragEvent());
    });
    expect(result.current.isDragOver).toBe(false);

    // Should still work normally after
    act(() => {
      result.current.dropZoneProps.onDragEnter(createDragEvent());
    });
    expect(result.current.isDragOver).toBe(true);
  });
});
