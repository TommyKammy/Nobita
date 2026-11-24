export interface FloatingAnchor {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface PlaceFloatingOptions {
  align?: 'start' | 'center';
  side?: 'above' | 'below';
  gap?: number;
  margin?: number;
  marginX?: number;
  marginY?: number;
  /** Clamp tall panels to the viewport when they cannot flip above. */
  fallback?: 'flip' | 'clamp';
}

/** Position a fixed panel next to an anchor and keep it inside the viewport. */
export function placeFloating(
  element: HTMLElement,
  anchor: FloatingAnchor,
  options: PlaceFloatingOptions = {}
): void {
  const width = element.offsetWidth;
  const height = element.offsetHeight;
  const marginX = options.marginX ?? options.margin ?? 8;
  const marginY = options.marginY ?? options.margin ?? 8;
  const gap = options.gap ?? 6;
  const align = options.align ?? 'start';
  const side = options.side ?? 'below';
  const fallback = options.fallback ?? 'flip';

  let left =
    align === 'center'
      ? anchor.left + (anchor.right - anchor.left) / 2 - width / 2
      : anchor.left;
  left = Math.max(marginX, Math.min(left, window.innerWidth - width - marginX));

  let top: number;
  if (side === 'above') {
    top = anchor.top - height - gap;
    if (top < marginY) top = anchor.bottom + gap;
  } else {
    top = anchor.bottom + gap;
    if (top + height > window.innerHeight - marginY) {
      const above = anchor.top - height - gap;
      top =
        fallback === 'clamp' && above < marginY
          ? Math.max(marginY, window.innerHeight - height - marginY)
          : Math.max(marginY, above);
    }
  }

  element.style.left = `${Math.round(left)}px`;
  element.style.top = `${Math.round(top)}px`;
}

export interface DismissFloatingOptions {
  element: HTMLElement;
  trigger?: HTMLElement | null;
  onDismiss: () => void;
  pointerTarget?: EventTarget;
  scroll?: boolean;
  resize?: boolean;
  /** Set to true for panels that intentionally close on their own scroll. */
  dismissOnInsideScroll?: boolean;
}

/**
 * Close a floating panel on outside pointerdown, scroll or resize.
 * Returns a cleanup function that removes every listener it registered.
 */
export function dismissFloating(options: DismissFloatingOptions): () => void {
  const pointerTarget = options.pointerTarget ?? window;
  const cleanups: (() => void)[] = [];

  const onPointer = (event: Event): void => {
    const path = event.composedPath();
    if (
      path.includes(options.element) ||
      (options.trigger && path.includes(options.trigger))
    ) {
      return;
    }
    options.onDismiss();
  };
  pointerTarget.addEventListener('pointerdown', onPointer, true);
  cleanups.push(() =>
    pointerTarget.removeEventListener('pointerdown', onPointer, true)
  );

  if (options.scroll) {
    const onScroll = (event: Event): void => {
      if (
        !options.dismissOnInsideScroll &&
        event.composedPath().includes(options.element)
      ) {
        return;
      }
      options.onDismiss();
    };
    window.addEventListener('scroll', onScroll, {
      capture: true,
      passive: true,
    });
    cleanups.push(() =>
      window.removeEventListener('scroll', onScroll, { capture: true })
    );
  }

  if (options.resize) {
    const onResize = (): void => options.onDismiss();
    window.addEventListener('resize', onResize);
    cleanups.push(() => window.removeEventListener('resize', onResize));
  }

  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}
