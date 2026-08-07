const PORTAL_LAYER_SELECTOR = [
  '[data-slot="select-content"]',
  '[data-slot="popover-content"]',
  '[data-slot="dropdown-menu-content"]',
  '[data-radix-popper-content-wrapper]',
].join(', ');

let openLayerCount = 0;
let lastLayerClosedAt = 0;

export function markLayerOpened() {
  openLayerCount += 1;
}

export function markLayerClosed() {
  openLayerCount = Math.max(0, openLayerCount - 1);
  lastLayerClosedAt = Date.now();
}

function getEventTarget(event: {
  target: EventTarget | null;
  detail?: { originalEvent?: Event };
}) {
  const original = event.detail?.originalEvent?.target;
  if (original instanceof Element) return original;
  if (event.target instanceof Element) return event.target;
  return null;
}

export function shouldIgnoreDialogDismiss(event: {
  target: EventTarget | null;
  detail?: { originalEvent?: Event };
}) {
  const target = getEventTarget(event);

  if (target?.closest(PORTAL_LAYER_SELECTOR)) {
    return true;
  }

  if (document.querySelector(PORTAL_LAYER_SELECTOR)) {
    return true;
  }

  if (openLayerCount > 0) {
    return true;
  }

  // Select/Popover can unmount before Dialog handles the same outside click.
  if (Date.now() - lastLayerClosedAt < 200) {
    return true;
  }

  return false;
}
