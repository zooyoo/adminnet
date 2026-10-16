import type { Ref, VNode } from 'vue';

import { h, onScopeDispose, ref, watch } from 'vue';

export function useDraggableModal(open: Ref<boolean>, disabled: Ref<boolean>) {
  const offset = ref({ x: 0, y: 0 });
  let drag: undefined | { element: HTMLElement; id: number; x: number; y: number; startX: number; startY: number };
  function finish() {
    if (drag?.element.hasPointerCapture(drag.id)) drag.element.releasePointerCapture(drag.id);
    drag = undefined;
  }
  function reset() {
    finish();
    offset.value = { x: 0, y: 0 };
  }
  function start(event: PointerEvent) {
    if (!open.value || disabled.value || event.button !== 0) return;
    const element = event.currentTarget as HTMLElement;
    drag = { element, id: event.pointerId, x: event.clientX, y: event.clientY, startX: offset.value.x, startY: offset.value.y };
    element.setPointerCapture(event.pointerId);
    event.preventDefault();
  }
  function move(event: PointerEvent) {
    if (!drag || drag.id !== event.pointerId || disabled.value) return;
    offset.value = { x: drag.startX + event.clientX - drag.x, y: drag.startY + event.clientY - drag.y };
  }
  function keyboard(event: KeyboardEvent) {
    if (disabled.value || !open.value) return;
    const step = event.shiftKey ? 20 : 10;
    const changes: Record<string, { x: number; y: number }> = { ArrowDown: { x: 0, y: step }, ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 }, ArrowUp: { x: 0, y: -step } };
    const delta = changes[event.key];
    if (!delta) return;
    event.preventDefault();
    offset.value = { x: offset.value.x + delta.x, y: offset.value.y + delta.y };
  }
  watch(open, reset);
  watch(disabled, (value) => { if (value) finish(); });
  onScopeDispose(finish);
  const render = (node: VNode) => h('div', { style: { transform: 'translate(' + offset.value.x + 'px, ' + offset.value.y + 'px)' } }, [node]);
  return { finish, keyboard, move, render, reset, start };
}
