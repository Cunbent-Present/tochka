(() => {
  'use strict';
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const timers = new WeakMap();
  function ripple(event) {
    if (reducedMotion.matches || !(event.target instanceof Element)) return;
    if (event.type === 'pointerdown' && event.button !== 0) return;
    if (event.type === 'click' && event.detail !== 0) return;
    const button = event.target.closest('.btn, button.mini, .rail-dl');
    if (!button || button.matches(':disabled, [aria-disabled="true"]')) return;
    const rect = button.getBoundingClientRect();
    const keyboard = event.type === 'click';
    button.style.setProperty('--ripple-x', `${keyboard ? rect.width / 2 : event.clientX - rect.left}px`);
    button.style.setProperty('--ripple-y', `${keyboard ? rect.height / 2 : event.clientY - rect.top}px`);
    button.style.setProperty('--ripple-size', `${Math.hypot(rect.width, rect.height) * 2}px`);
    clearTimeout(timers.get(button));
    button.classList.remove('button-ripple');
    void button.offsetWidth;
    button.classList.add('button-ripple');
    timers.set(button, setTimeout(() => button.classList.remove('button-ripple'), 600));
  }
  // Capture also covers controls created dynamically by the CRM.
  document.addEventListener('pointerdown', ripple, { capture: true, passive: true });
  document.addEventListener('click', ripple, { capture: true, passive: true });
})();
