import { computed, onScopeDispose, ref } from 'vue';

export function useCaptchaExpiry() {
 const deadline = ref(0);
 const remainingSeconds = ref(0);
 let timer: ReturnType<typeof setInterval> | undefined;
 function stop() {
  if (timer) clearInterval(timer);
  timer = undefined;
  deadline.value = 0;
  remainingSeconds.value = 0;
 }
 function arm(expirySeconds: number) {
  stop();
  const ttl = Number.isFinite(expirySeconds) ? Math.max(0, expirySeconds) : 0;
  deadline.value = Date.now() + ttl * 1000;
  const update = () => {
   remainingSeconds.value = Math.max(0, Math.ceil((deadline.value - Date.now()) / 1000));
   if (remainingSeconds.value === 0 && timer) {
    clearInterval(timer);
    timer = undefined;
   }
  };
  update();
  if (remainingSeconds.value > 0) timer = setInterval(update, 200);
 }
 onScopeDispose(stop);
 return { arm, expired: computed(() => deadline.value > 0 && remainingSeconds.value === 0), remainingSeconds, stop };
}
