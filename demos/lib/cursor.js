// ============================================================
//  Dependency-freier Demo-Cursor (injiziert via addInitScript).
//  Wird vom Harness über window.__demoCursor gesteuert; synchron
//  zu echten Playwright-Mausbewegungen. Klick erzeugt Ripple.
// ============================================================
(() => {
  if (window.__demoCursor) return;

  function mount() {
    const wrap = document.createElement('div');
    wrap.id = '__demo_cursor';
    wrap.style.cssText = [
      'position:fixed', 'left:0', 'top:0', 'width:0', 'height:0',
      'pointer-events:none', 'z-index:2147483647',
      'transform:translate(-100px,-100px)',
    ].join(';');

    // Pfeil-Cursor (SVG), weicher Schatten für Lesbarkeit auf hell+dunkel.
    wrap.innerHTML =
      '<svg width="30" height="30" viewBox="0 0 30 30" style="position:absolute;left:-3px;top:-2px;' +
      'filter:drop-shadow(0 2px 4px rgba(0,0,0,.35))">' +
      '<path d="M5 3 L5 23 L11 17 L15 25 L18 23 L14 16 L22 16 Z" ' +
      'fill="#fff" stroke="#122530" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.documentElement.appendChild(wrap);
    return wrap;
  }

  let el = null;
  function ensure() {
    if (!el || !el.isConnected) el = mount();
    return el;
  }

  function setPos(x, y) {
    const e = ensure();
    e.style.transform = `translate(${x}px, ${y}px)`;
  }

  function ripple(x, y, color) {
    const r = document.createElement('div');
    r.style.cssText = [
      'position:fixed', `left:${x}px`, `top:${y}px`,
      'width:14px', 'height:14px', 'margin:-7px 0 0 -7px', 'border-radius:50%',
      'pointer-events:none', 'z-index:2147483646',
      `border:2px solid ${color || '#14c2da'}`,
      'opacity:0.9', 'transform:scale(0.4)',
      'transition:transform .45s cubic-bezier(.22,.61,.36,1), opacity .45s ease-out',
    ].join(';');
    document.documentElement.appendChild(r);
    requestAnimationFrame(() => {
      r.style.transform = 'scale(3)';
      r.style.opacity = '0';
    });
    setTimeout(() => r.remove(), 520);
  }

  // press = optionaler "gedrückt"-Look (für Drag).
  function press(down) {
    const e = ensure();
    e.style.opacity = down ? '0.85' : '1';
  }

  window.__demoCursor = { setPos, ripple, press, ensure };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensure);
  } else {
    ensure();
  }
})();
