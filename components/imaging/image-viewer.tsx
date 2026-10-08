"use client";

import * as React from "react";
import {
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  RotateCcw,
  RotateCw,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils/cn";
import { Badge } from "@/components/ui/badge";

const MIN_SCALE = 0.2;
const MAX_SCALE = 8;

/**
 * Medical image viewer.
 *
 * Purpose-built for radiology-style viewing: pinch and wheel zoom, drag to pan,
 * rotate in 90° steps, one-tap fullscreen, and a reset. Built by hand rather
 * than with a viewer dependency so the bundle stays small and behaviour is
 * predictable.
 *
 * Accessibility: the dialog traps focus, closes on Escape, and exposes the zoom
 * level to assistive technology through aria-live. All controls are real buttons
 * with labels.
 */
export function ImageViewer({
  src,
  alt,
  fileName,
  observations,
  onClose,
}: {
  src: string;
  alt: string;
  fileName: string;
  /** Optional side panel of AI observations. */
  observations?: Array<{ observation: string; uncertainty: string; evidence: string }>;
  onClose: () => void;
}) {
  const [scale, setScale] = React.useState(1);
  const [rotation, setRotation] = React.useState(0);
  const [offset, setOffset] = React.useState({ x: 0, y: 0 });
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  const [showPanel, setShowPanel] = React.useState(true);

  const containerRef = React.useRef<HTMLDivElement>(null);
  // The in-flight drag is held in a ref (it changes on every pointer move and
  // must never trigger a render), but whether a drag is ACTIVE is mirrored into
  // state so the cursor can be styled during render without reading a ref.
  const dragState = React.useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(
    null,
  );
  const [isDragging, setIsDragging] = React.useState(false);
  const pinchDistance = React.useRef<number | null>(null);

  const clamp = (value: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));

  const reset = React.useCallback(() => {
    setScale(1);
    setRotation(0);
    setOffset({ x: 0, y: 0 });
  }, []);

  const zoomBy = React.useCallback((factor: number) => {
    setScale((current) => clamp(current * factor));
  }, []);

  // Wheel zoom, anchored at the pointer so the point under the cursor stays put.
  const onWheel = React.useCallback((event: React.WheelEvent) => {
    event.preventDefault();
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const pointerX = event.clientX - rect.left - rect.width / 2;
    const pointerY = event.clientY - rect.top - rect.height / 2;

    setScale((current) => {
      const next = clamp(current * (event.deltaY < 0 ? 1.14 : 1 / 1.14));
      if (next === current) return current;
      const ratio = next / current;
      setOffset((prev) => ({
        x: pointerX - (pointerX - prev.x) * ratio,
        y: pointerY - (pointerY - prev.y) * ratio,
      }));
      return next;
    });
  }, []);

  const onPointerDown = (event: React.PointerEvent) => {
    if (scale <= 1) return;
    dragState.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: offset.x,
      originY: offset.y,
    };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    setIsDragging(true);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const drag = dragState.current;
    if (!drag) return;
    setOffset({
      x: drag.originX + (event.clientX - drag.startX),
      y: drag.originY + (event.clientY - drag.startY),
    });
  };

  const onPointerUp = (event: React.PointerEvent) => {
    dragState.current = null;
    setIsDragging(false);
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
  };

  // Two-finger pinch.
  const onTouchMove = (event: React.TouchEvent) => {
    if (event.touches.length !== 2) return;
    const [first, second] = [event.touches[0], event.touches[1]];
    if (!first || !second) return;

    const distance = Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);

    if (pinchDistance.current === null) {
      pinchDistance.current = distance;
      return;
    }

    const ratio = distance / pinchDistance.current;
    pinchDistance.current = distance;
    setScale((current) => clamp(current * ratio));
  };

  const toggleFullscreen = React.useCallback(async () => {
    const element = containerRef.current?.parentElement;
    if (!element) return;
    try {
      if (!document.fullscreenElement) {
        await element.requestFullscreen();
        setIsFullscreen(true);
      } else {
        await document.exitFullscreen();
        setIsFullscreen(false);
      }
    } catch {
      setIsFullscreen(false);
    }
  }, []);

  React.useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  // Escape closes. Tab is trapped inside the dialog.
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (document.fullscreenElement) {
          void document.exitFullscreen();
          return;
        }
        onClose();
        return;
      }

      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        zoomBy(1.2);
        return;
      }
      if (event.key === "-") {
        event.preventDefault();
        zoomBy(1 / 1.2);
        return;
      }
      if (event.key === "0") {
        event.preventDefault();
        reset();
        return;
      }

      if (event.key === "Tab") {
        const focusable = containerRef.current?.parentElement?.querySelectorAll<HTMLElement>(
          "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
        );
        if (!focusable || focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first || !last) return;

        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose, reset, zoomBy]);

  const zoomPercent = Math.round(scale * 100);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Image viewer: ${fileName}`}
      className="fixed inset-0 z-[60] flex flex-col bg-slate-950/92 backdrop-blur-md"
    >
      {/* Header */}
      <div className="flex shrink-0 items-center gap-3 border-b border-white/10 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-white" title={fileName}>
            {fileName}
          </p>
          <p className="text-xs text-white/50">Uploaded image · not a radiology report</p>
        </div>

        {observations && observations.length > 0 ? (
          <button
            type="button"
            onClick={() => setShowPanel((current) => !current)}
            className="hidden rounded-full border border-white/15 px-3 py-1.5 text-xs font-medium text-white/80 transition-colors hover:bg-white/10 sm:inline-flex"
            aria-expanded={showPanel}
          >
            {showPanel ? "Hide" : "Show"} AI observations ({observations.length})
          </button>
        ) : null}

        <button
          type="button"
          onClick={onClose}
          className="rounded-full p-2 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
          aria-label="Close image viewer"
        >
          <X className="size-5" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Canvas */}
        <div className="relative flex min-w-0 flex-1 flex-col">
          <div
            ref={containerRef}
            onWheel={onWheel}
            onTouchMove={onTouchMove}
            onTouchEnd={() => {
              pinchDistance.current = null;
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            className={cn(
              "relative flex min-h-0 flex-1 items-center justify-center overflow-hidden",
              scale > 1 ? (isDragging ? "cursor-grabbing" : "cursor-grab") : "cursor-default",
            )}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt={alt}
              draggable={false}
              className="max-h-full max-w-full select-none object-contain"
              style={{
                transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale}) rotate(${rotation}deg)`,
                transition: isDragging ? "none" : "transform 120ms ease-out",
              }}
            />

            <p className="sr-only" aria-live="polite">
              Zoom {zoomPercent} percent, rotated {rotation} degrees
            </p>
          </div>

          {/* Toolbar */}
          <div className="flex shrink-0 items-center justify-center gap-1.5 border-t border-white/10 px-4 py-3">
            <ViewerButton label="Zoom out" onClick={() => zoomBy(1 / 1.25)} disabled={scale <= MIN_SCALE}>
              <Minus className="size-4" />
            </ViewerButton>

            <span
              className="w-14 text-center text-xs font-medium tabular-nums text-white/70"
              aria-hidden="true"
            >
              {zoomPercent}%
            </span>

            <ViewerButton label="Zoom in" onClick={() => zoomBy(1.25)} disabled={scale >= MAX_SCALE}>
              <Plus className="size-4" />
            </ViewerButton>

            <span className="mx-1 h-5 w-px bg-white/15" aria-hidden="true" />

            <ViewerButton label="Rotate left" onClick={() => setRotation((r) => r - 90)}>
              <RotateCcw className="size-4" />
            </ViewerButton>
            <ViewerButton label="Rotate right" onClick={() => setRotation((r) => r + 90)}>
              <RotateCw className="size-4" />
            </ViewerButton>

            <span className="mx-1 h-5 w-px bg-white/15" aria-hidden="true" />

            <ViewerButton label="Reset view" onClick={reset}>
              <span className="text-xs font-semibold">Reset</span>
            </ViewerButton>

            <ViewerButton label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"} onClick={() => void toggleFullscreen()}>
              {isFullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
            </ViewerButton>
          </div>

          <p className="hidden shrink-0 pb-3 text-center text-[0.6875rem] text-white/40 sm:block">
            Scroll or pinch to zoom · drag to pan · arrow-free keyboard: + and − to zoom, 0 to reset,
            Esc to close
          </p>
        </div>

        {/* Observations panel */}
        {observations && observations.length > 0 && showPanel ? (
          <aside className="hidden w-[340px] shrink-0 overflow-y-auto border-l border-white/10 p-5 lg:block">
            <div className="flex items-center gap-2">
              <Badge tone="accent">AI observations</Badge>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-white/50">
              These are AI-generated descriptions of what appeared to be visible, not radiological
              interpretations. No clinician has reviewed the original study.
            </p>

            <ol className="mt-5 space-y-4">
              {observations.map((observation, index) => (
                <li key={index} className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
                  <p className="text-sm leading-relaxed text-white/90">{observation.observation}</p>
                  <p className="mt-2 text-xs text-white/50">
                    Uncertainty: {observation.uncertainty}
                  </p>
                  {observation.evidence ? (
                    <p className="mt-1.5 text-xs leading-relaxed text-white/40">{observation.evidence}</p>
                  ) : null}
                </li>
              ))}
            </ol>
          </aside>
        ) : null}
      </div>
    </div>
  );
}

function ViewerButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="inline-flex h-9 min-w-9 items-center justify-center rounded-full border border-white/15 px-2.5 text-white/80 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}