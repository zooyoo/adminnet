import type { Watermark, WatermarkOptions } from 'watermark-js-plus';

import { nextTick, onScopeDispose, readonly, ref, shallowRef } from 'vue';

export function useWatermark() {
const watermark = shallowRef<Watermark>();
let generation = 0;
let disposed = false;
let pending = Promise.resolve();
const cachedOptions = ref<Partial<WatermarkOptions>>({
  advancedStyle: {
    colorStops: [
      {
        color: 'gray',
        offset: 0,
      },
      {
        color: 'gray',
        offset: 1,
      },
    ],
    type: 'linear',
  },
  // fontSize: '20px',
  content: '',
  contentType: 'multi-line-text',
  globalAlpha: 0.25,
  gridLayoutOptions: {
    cols: 2,
    gap: [20, 20],
    matrix: [
      [1, 0],
      [0, 1],
    ],
    rows: 2,
  },
  height: 200,
  layout: 'grid',
  rotate: 30,
  width: 160,
});

  async function initWatermark(options: Partial<WatermarkOptions>, current: number) {
    const { Watermark } = await import('watermark-js-plus');
    if (disposed || current !== generation) return;

    cachedOptions.value = {
      ...cachedOptions.value,
      ...options,
    };
    const instance = new Watermark(cachedOptions.value);
    watermark.value = instance;
    await instance.create();
    if (disposed || current !== generation) {
      instance.destroy();
      if (watermark.value === instance) watermark.value = undefined;
    }
  }

  function updateWatermark(options: Partial<WatermarkOptions>) {
    const current = ++generation;
    pending = pending.catch(() => {}).then(async () => {
      if (disposed || current !== generation) return;
      const instance = watermark.value;
      if (instance) {
        await nextTick();
        if (disposed || current !== generation) return;
        await instance.changeOptions({ ...cachedOptions.value, ...options });
        if (disposed || current !== generation) {
          instance.destroy();
          if (watermark.value === instance) watermark.value = undefined;
        }
      } else {
        await initWatermark(options, current);
      }
    });
    return pending;
  }

  function destroyWatermark() {
    generation++;
    if (watermark.value) {
      watermark.value.destroy();
      watermark.value = undefined;
    }
  }

  // 每个布局拥有独立水印，退出后的异步创建不能污染下一次登录。
  onScopeDispose(() => {
    disposed = true;
    destroyWatermark();
    cachedOptions.value.content = '';
  });

  return {
    destroyWatermark,
    updateWatermark,
    watermark: readonly(watermark),
  };
}
