/* =====================================================================
 * 生活记录 · 交互层（app-interaction-6）
 *
 * 全部动效由物理模型驱动，不是手调时长：
 *   · 弹性 —— 阻尼谐振子 DHO：m·ẍ + c·ẋ + k·x = 0
 *   · 惯性 —— 匀减速：x(t) = v₀t − ½dt²，v(t) = v₀ − dt
 *
 * 本文件只做「表现层」，不触碰任何业务逻辑：
 *   · 不修改现有函数
 *   · 不改变数据流
 *   · 只挂监听、只加视觉状态
 * ===================================================================== */

/* =====================================================================
 * 0. 物理常量与工具
 * ===================================================================== */

/* 弹簧参数表 —— 单一数据源，数值来自物理备忘单的算术：
   c = 2·ζ·√(k·m)，已验证 */
const SPRINGS = {
  button: { k: 480, m: 1, c: 43.82, zeta: 1.0 },   // ζ=1  静止≈183ms
  card:   { k: 150, m: 1.5, c: 21.21, zeta: 0.7 }, // ζ=0.7 静止≈566ms
  snap:   { k: 200, m: 1, c: 28.28, zeta: 1.0 },   // ζ=1  静止≈283ms
  wheel:  { k: 250, m: 1, c: 31.62, zeta: 1.0 },   // ζ=1  静止≈253ms
  bounce: { k: 300, m: 1, c: 17.32, zeta: 0.5 },   // ζ=0.5 静止≈462ms
};

/* 惯性减速 —— 单位刻意标注在变量名里，防止帧域/时域混用导致 60× 误差 */
const INERTIA = {
  cardDPxPerFrame2: 0.5,          // 2.4 卡片：快速停下，交给弹簧吸附
  wheelDPxPerFrame2: 0.3,         // 2.5 滚轮：滑得更久（与卡片刻意不同）
  cardStopPxPerFrame: 5,          // 2.4 速度阈值
};

const prefersReduced = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * 半隐式欧拉 DHO 积分器。
 * 半隐式（先更新 v 再更新 x）在 60fps 下对本项目的刚度是稳定的，显式欧拉会发散。
 * 支持 retarget —— 用户可中途打断，动量不丢。
 */
function createSpring({ k, m, c, initial = 0, target = 0, onFrame, onRest }) {
  let x = initial - target;
  let v = 0;
  let raf = null;
  let last = 0;
  let alive = true;

  /* 静止阈值按「初始位移的比例」计算，而不是固定 0.1。
     scale 这类 0–1 量级的动画初始位移可能只有 0.12，
     固定 0.1 的阈值会让弹簧一开始就被判定为静止，冲不出过冲。 */
  const amplitude = Math.abs(x) || 1;
  const restX = Math.max(amplitude * 0.002, 1e-4);
  const restV = Math.max(amplitude * 0.002, 1e-4);

  const step = (now) => {
    if (!alive) return;
    // dt 上限 1/30：切标签页回来时不会因为超大 dt 炸掉
    const dt = Math.min((now - last) / 1000, 1 / 30);
    last = now;

    // 子步长：高刚度低质量时保证稳定
    const SUB = 4;
    const h = dt / SUB;
    for (let i = 0; i < SUB; i++) {
      const a = (-k * x - c * v) / m;
      v += a * h;
      x += v * h;
    }

    if (onFrame) onFrame(target + x, v);

    // 静止判定：相对初始幅度可忽略，且速度足够小
    if (Math.abs(x) < restX && Math.abs(v) < restV) {
      if (onFrame) onFrame(target, 0);
      if (onRest) onRest();
      raf = null;
      return;
    }
    raf = requestAnimationFrame(step);
  };

  return {
    start() {
      if (prefersReduced()) {                 // 减弱动效：直接到位
        if (onFrame) onFrame(target, 0);
        if (onRest) onRest();
        return;
      }
      last = performance.now();
      raf = requestAnimationFrame(step);
    },
    stop() { alive = false; if (raf) cancelAnimationFrame(raf); raf = null; },
    /** 中途改目标：保留当前速度 —— 这是 CSS 做不到的 */
    retarget(newTarget) { target = newTarget; },
    get velocity() { return v; },
    get position() { return target + x; },
  };
}

/* =====================================================================
 * 1. 交互 2.1 —— 完成反馈按钮
 *
 * 流程：点按 → 临界阻尼收缩成圆 → 100ms 后画对勾 → 粒子指数衰减散射
 * 预算：≤300ms（k=480 把静止压到 183ms，给 100ms 延迟留出余量）
 * ===================================================================== */
const CHECK_PATH_LEN = 32;

function ensureCheckLayer(btn) {
  if (btn.querySelector('.btn-check')) return;
  const wrap = document.createElement('span');
  wrap.className = 'btn-check';
  wrap.setAttribute('aria-hidden', 'true');
  wrap.innerHTML =
    '<svg viewBox="0 0 24 24">' +
    '<path d="M5 12.5 L10 17.5 L19 7.5" ' +
    `style="--check-len:${CHECK_PATH_LEN}" />` +
    '</svg>';
  btn.appendChild(wrap);
}

/* 粒子散射：指数速度衰减 v(t) = v₀·e^(−0.5t) */
function burstParticles(originEl, count = 8, v0 = 260) {
  if (prefersReduced()) return;

  const rect = originEl.getBoundingClientRect();
  const ox = rect.left + rect.width / 2;
  const oy = rect.top + rect.height / 2;

  let canvas = document.querySelector('.burst-canvas');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.className = 'burst-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas);
  }
  const dpr = window.devicePixelRatio || 1;
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, innerWidth, innerHeight);

  const accent = getComputedStyle(document.documentElement)
    .getPropertyValue('--accent').trim() || '#007AFF';

  const parts = Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2 - Math.PI / 2;
    return {
      ax: Math.cos(a), ay: Math.sin(a),
      born: performance.now(),
      life: 400,
    };
  });

  const DECAY = 0.5;      // 指数衰减系数
  const GRAVITY = 420;    // 轻微重力，让轨迹有重量感

  const draw = (now) => {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    let alive = false;

    for (const p of parts) {
      const t = (now - p.born) / 1000;
      if (t > p.life / 1000) continue;
      alive = true;

      /* 指数衰减下的位移：对 v₀·e^(−λt) 积分
         s(t) = (v₀/λ)·(1 − e^(−λt)) */
      const s = (v0 / DECAY) * (1 - Math.exp(-DECAY * t));
      const px = ox + p.ax * s;
      const py = oy + p.ay * s + 0.5 * GRAVITY * t * t;

      ctx.globalAlpha = Math.max(0, 1 - t / (p.life / 1000));
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(px, py, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1;
    if (alive) requestAnimationFrame(draw);
    else {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
    }
  };
  requestAnimationFrame(draw);
}

/* 给按钮挂上完成反馈（不侵入原有 submit 逻辑） */
function attachCompleteFeedback(form) {
  const btn = form.querySelector('button[type="submit"]');
  if (!btn || btn.dataset.feedbackReady === '1') return;
  btn.dataset.feedbackReady = '1';

  // 把原来的文字包一层，便于淡出
  const text = btn.textContent;
  btn.textContent = '';
  const label = document.createElement('span');
  label.className = 'btn-label';
  label.textContent = text;
  btn.appendChild(label);

  ensureCheckLayer(btn);

  /* 关键：在 capture 阶段抢在业务逻辑之前记录当前条目数。
     业务逻辑是在冒泡阶段跑的（app.js 里的 submit handler），
     等到我们的冒泡监听器执行时 DOM 已经更新了，比较就没意义。 */
  const list = $('#dayList');
  let countBefore = 0;

  form.addEventListener('submit', () => {
    countBefore = list ? list.querySelectorAll('.item').length : 0;
  }, { capture: true });   // ← capture：先于业务逻辑执行

  form.addEventListener('submit', () => {
    // 业务逻辑（写入 + render）已在此刻完成，可以安全比较
    const countAfter = list ? list.querySelectorAll('.item').length : 0;
    if (countAfter > countBefore) playComplete(btn);
  });
}

function playComplete(btn) {
  if (!btn || btn.classList.contains('is-complete')) return;
  if (prefersReduced()) return;

  // 全程用 CSS 类驱动，不写内联样式 ——
  // render() 触发重绘时会清掉内联 transform，改用类才稳定生效。
  btn.classList.add('is-complete');

  // 粒子散射：等对勾画出来（100ms）之后再放，视觉上有先后
  setTimeout(() => burstParticles(btn, 8, 260), 120);

  // 复原：不阻断连续记账
  setTimeout(() => {
    btn.classList.remove('is-complete');
  }, 1500);
}

/* =====================================================================
 * 2. 分类标签的物理选中反馈
 *
 * 需求：选中一个分类时要有"物理感"，不能只是变个颜色。
 *
 * 用两层物理叠加：
 *   ① 被选中的那个：ζ=0.5 欠阻尼弹簧，明显回弹（按下 → 弹出）
 *   ② 相邻的标签：被"顶开"一点再归位，模拟实体按键的挤压传导
 *
 * 弹簧用 createSpring 逐帧积分，可被下一次点击打断（retarget）。
 * ===================================================================== */
const CHIP_SPRING = { k: 420, m: 1, c: 20.5 };   // ζ≈0.5 明显回弹
const NEIGHBOR_SPRING = { k: 300, m: 1, c: 34.6 }; // ζ=1 无回弹，只做位移

/* 一个标签当前正在跑的动画，便于打断 */
const chipAnims = new WeakMap();

function springScale(el, from, to, spring, onDone) {
  // 打断该元素上正在跑的动画
  const prev = chipAnims.get(el);
  if (prev) prev.stop();

  const s = createSpring({
    k: spring.k, m: spring.m, c: spring.c,
    initial: from,
    target: to,
    onFrame: (v) => { el.style.scale = String(v); },
    onRest: () => {
      el.style.scale = '';
      chipAnims.delete(el);
      if (onDone) onDone();
    },
  });
  chipAnims.set(el, s);
  s.start();
  return s;
}

function springShift(el, from, to, spring) {
  const key = 'shift';
  let prev = el['__shiftSpring'];
  if (prev) prev.stop();

  const s = createSpring({
    k: spring.k, m: spring.m, c: spring.c,
    initial: from,
    target: to,
    onFrame: (v) => { el.style.transform = `translateX(${v.toFixed(2)}px)`; },
    onRest: () => { el.style.transform = ''; el.__shiftSpring = null; },
  });
  el.__shiftSpring = s;
  s.start();
  return s;
}

function attachChipPhysics() {
  $$('.chips').forEach((box) => {
    box.addEventListener('click', (ev) => {
      const chip = ev.target.closest('.chip');
      // 「＋ 新分类」按钮走自己的逻辑，不参与物理反馈
      if (!chip || chip.classList.contains('chip-add')) return;
      if (prefersReduced()) return;

      const chips = [...box.querySelectorAll('.chip:not(.chip-add)')];
      const idx = chips.indexOf(chip);
      if (idx < 0) return;

      // ① 被选中的标签：按下 0.9 再弹回 1（ζ=0.5 有可见回弹）
      springScale(chip, 0.88, 1, CHIP_SPRING);

      // ② 相邻标签被顶开 —— 左邻左移、右邻右移，然后归位
      //    距离越远影响越小，符合弹性传导
      chips.forEach((other, i) => {
        if (other === chip) return;
        const dist = i - idx;
        const push = Math.sign(dist) * Math.max(0, 4 - Math.abs(dist) * 1.5);
        if (push === 0) return;
        springShift(other, push, 0, NEIGHBOR_SPRING);
      });
    }, { capture: true });   // 先于原有的选中逻辑执行，但不阻断它
  });
}
/**
 * 页面切换的轻量过渡。
 *
 * 之前用 clip-path: circle() 做圆形扩散 —— 在 iOS Safari 上
 * clip-path 走 CPU 合成，每帧要重新光栅化整个视口，帧率会掉。
 * 这里改成只有 transform + opacity 的位移淡入：
 *   · transform/opacity 走 GPU 合成层，稳定 60fps
 *   · 不做全屏覆盖，只让内容轻轻位移，符合「不要过度动画」
 *
 * @keyframes 定义在 style.css 里（静态），不在此处动态注入 ——
 * 动态注入的 keyframes 会与样式解析竞争，导致动画不生效。
 */
function attachPageTransition() {
  if (!$('#main')) return;

  let running = false;
  let currentAnim = null;

  $$('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.nav;
      if (target === state.page) return;
      if (prefersReduced()) return;
      // 连点保护：已有动画在跑时先取消，避免叠加
      if (currentAnim) { try { currentAnim.cancel(); } catch (e) {} currentAnim = null; }
      running = false;

      // 方向感：去「总结」从右滑入，回「记录」从左滑入
      const forward = target === 'report';

      /* switchPage 是同步的，会在本帧内把新页面显示出来。
         下一帧给「新的当前页」加动画类，让它从侧面淡入。 */
      requestAnimationFrame(() => {
        const page = document.querySelector(`.page[data-page="${target}"]`);
        if (!page) { running = false; return; }

        const from = forward ? 10 : -10;

        if (typeof page.animate === 'function') {
          /* 用 Web Animations API 而不是 CSS 动画类：
             WAAPI 的 finished Promise 能精确知道动画结束，
             也便于在需要时取消（用户快速连点时不会叠加）。 */
          const anim = page.animate(
            [
              { opacity: 0, transform: `translateX(${from}px)` },
              { opacity: 1, transform: 'translateX(0)' },
            ],
            { duration: 300, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'both' }
          );
          currentAnim = anim;
          anim.finished
            .then(() => { anim.cancel(); if (currentAnim === anim) currentAnim = null; running = false; })
            .catch(() => { running = false; });   // cancel 会 reject，忽略
        } else {
          // 老引擎回退到类驱动
          page.style.setProperty('--page-shift', `${from}px`);
          page.classList.remove('is-switching-in');
          void page.offsetWidth;
          page.classList.add('is-switching-in');
          setTimeout(() => {
            page.classList.remove('is-switching-in');
            page.style.removeProperty('--page-shift');
            running = false;
          }, 340);
        }
      });
    }, { capture: true });
  });
}

/* =====================================================================
 * 3. 交互 2.3 —— 洞察卡展开（ζ=0.7 错开）
 *
 * 错开延迟按公式算：delay = min(100, (800 − 566) / (n − 1))
 * ζ=0.7 静止约 566ms，总预算 800ms
 * ===================================================================== */
function attachInsightExpand() {
  const grid = $('#reportBody');
  if (!grid) return;

  grid.addEventListener('click', (ev) => {
    const card = ev.target.closest('.insight');
    if (!card) return;
    if (ev.target.closest('a, button')) return;

    const cards = [...grid.querySelectorAll('.insight')];
    const opening = !card.classList.contains('is-open');

    // 只让被点的这张展开，其余收起（避免多张同时铺满）
    cards.forEach((c) => {
      if (c !== card) {
        c.classList.remove('is-open');
        c.setAttribute('aria-expanded', 'false');
      }
    });
    card.classList.toggle('is-open', opening);
    // 无障碍状态与视觉状态保持一致
    card.setAttribute('aria-expanded', opening ? 'true' : 'false');
  });

  // 键盘可达：Enter / Space 也能展开
  grid.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    const card = ev.target.closest('.insight');
    if (!card) return;
    ev.preventDefault();
    card.click();
  });

  // 卡片数量变化时重算错开延迟（遵守 800ms 预算）
  const applyStagger = () => {
    const cards = [...grid.querySelectorAll('.insight')];
    const settleMs = 566;                    // ζ=0.7 静止时间
    const budgetMs = 800;
    const delay = cards.length > 1
      ? Math.min(100, Math.max(0, (budgetMs - settleMs) / (cards.length - 1)))
      : 0;
    cards.forEach((c, i) => {
      c.style.transitionDelay = `${Math.round(i * delay)}ms`;
    });
  };
  applyStagger();

  // 渲染后重新计算（洞察卡是动态生成的）
  const mo = new MutationObserver(applyStagger);
  mo.observe(grid, { childList: true, subtree: true });
}

/* =====================================================================
 * 4. 交互 2.4 —— 吸附卡片 + 时间轴绘制
 *
 * 惯性用帧域积分：v 每帧减 d，速度低于阈值后交给 ζ=1 弹簧吸附
 * ===================================================================== */
function createSwipeDeck(deckEl) {
  const track = deckEl.querySelector('.swipe-track');
  if (!track) return null;
  const cards = [...track.children];
  if (cards.length < 2) return null;

  const dotsBox = deckEl.querySelector('.swipe-dots');
  let index = 0;
  let offset = 0;             // 当前 translateX
  let raf = null;
  let spring = null;

  const cardWidth = () => cards[0].getBoundingClientRect().width +
    parseFloat(getComputedStyle(track).gap || 0);

  const apply = (x) => {
    offset = x;
    track.style.transform = `translateX(${x}px)`;
  };

  const updateDots = () => {
    if (!dotsBox) return;
    [...dotsBox.children].forEach((d, i) => {
      d.classList.toggle('is-active', i === index);
    });
  };

  /* ζ=1 吸附到最近一张 */
  const snapTo = (i) => {
    index = Math.max(0, Math.min(cards.length - 1, i));
    if (spring) spring.stop();
    const target = -index * cardWidth();

    spring = createSpring({
      k: SPRINGS.snap.k, m: SPRINGS.snap.m, c: SPRINGS.snap.c,
      initial: offset,
      target,
      onFrame: (p) => apply(p),
      onRest: () => { updateDots(); drawTimeline(cards[index]); },
    });
    spring.start();
  };

  /* 惯性滑动，速度低于阈值后吸附 */
  const fling = (v0) => {
    if (raf) cancelAnimationFrame(raf);
    if (spring) spring.stop();

    let v = v0;
    const d = INERTIA.cardDPxPerFrame2;

    const step = () => {
      if (Math.abs(v) < INERTIA.cardStopPxPerFrame) {
        // 交给弹簧，按方向决定吸附到哪张
        const dir = v0 > 0 ? Math.floor(-offset / cardWidth() + 0.5)
                           : Math.round(-offset / cardWidth());
        snapTo(dir);
        return;
      }
      const next = offset + v;
      // 边界阻尼：越界时速度衰减得更快，避免飞出天际
      const minX = -(cards.length - 1) * cardWidth();
      const clamped = Math.max(minX, Math.min(0, next));
      if (clamped !== next) v *= 0.5;
      apply(clamped);
      v = v > 0 ? Math.max(0, v - d) : Math.min(0, v + d);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  };

  /* 时间轴绘制：200px/s，上限 300ms，卡片再次滑动时立即可打断 */
  const drawTimeline = (card) => {
    const line = card && card.querySelector('.timeline-line');
    if (!line) return;
    line.style.transition = 'none';
    line.style.width = '0%';
    requestAnimationFrame(() => {
      const durMs = 300;    // 上限，保证 ≤300ms 规则
      line.style.transition = `width ${durMs}ms linear`;
      line.style.width = '100%';
    });
  };

  /* ---- 手势 ---- */
  let startX = 0, startY = 0, lastX = 0, lastT = 0, v = 0, dragging = false, axisLocked = null;

  deckEl.addEventListener('pointerdown', (ev) => {
    dragging = true;
    axisLocked = null;
    startX = lastX = ev.clientX;
    startY = ev.clientY;
    lastT = performance.now();
    v = 0;
    if (raf) cancelAnimationFrame(raf);
    if (spring) spring.stop();
  });

  deckEl.addEventListener('pointermove', (ev) => {
    if (!dragging) return;
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;

    // 轴向锁定：横向意图明确才接管，否则让页面正常竖向滚动
    if (axisLocked === null) {
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
        axisLocked = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      } else return;
    }
    if (axisLocked !== 'x') return;

    ev.preventDefault();
    const now = performance.now();
    const dt = Math.max(1, now - lastT);
    v = (ev.clientX - lastX) / dt * 16;   // 换算成 px/frame
    lastX = ev.clientX;
    lastT = now;

    apply(offset + dx * 0);   // 保持跟手：重新计算
    const base = -index * cardWidth();
    apply(Math.max(-(cards.length - 1) * cardWidth(),
          Math.min(0, base + dx)));
  }, { passive: false });

  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    if (axisLocked !== 'x') return;
    if (Math.abs(v) > 2) fling(v);
    else snapTo(Math.round(-offset / cardWidth()));
  };

  deckEl.addEventListener('pointerup', endDrag);
  deckEl.addEventListener('pointercancel', endDrag);
  deckEl.addEventListener('pointerleave', endDrag);

  // 初始状态
  requestAnimationFrame(() => {
    apply(0);
    updateDots();
    drawTimeline(cards[0]);
  });

  return { snapTo, get index() { return index; } };
}

/* =====================================================================
 * 5. 交互 2.5 —— 惯性滚轮
 * ===================================================================== */
function createWheel(pickerEl, items) {
  const strip = pickerEl.querySelector('.wheel-strip');
  if (!strip) return null;

  const ITEM_H = 44;
  let index = 0;
  let offset = 0;
  let raf = null;
  let spring = null;

  const apply = (y) => {
    offset = y;
    strip.style.transform = `translateY(${y}px)`;
    const cur = Math.round(-y / ITEM_H);
    [...strip.children].forEach((el, i) => {
      el.classList.toggle('is-current', i === cur);
    });
  };

  const snapTo = (i) => {
    index = Math.max(0, Math.min(items.length - 1, i));
    if (spring) spring.stop();
    const target = -index * ITEM_H;

    spring = createSpring({
      k: SPRINGS.wheel.k, m: SPRINGS.wheel.m, c: SPRINGS.wheel.c,
      initial: offset,
      target,
      onFrame: (p) => apply(p),
    });
    spring.start();
  };

  /* 越界回弹：ζ=0.5，可见过冲 */
  const bounceTo = (target) => {
    if (spring) spring.stop();
    spring = createSpring({
      k: SPRINGS.bounce.k, m: SPRINGS.bounce.m, c: SPRINGS.bounce.c,
      initial: offset,
      target,
      onFrame: (p) => apply(p),
    });
    spring.start();
  };

  const fling = (v0) => {
    if (raf) cancelAnimationFrame(raf);
    if (spring) spring.stop();

    let v = v0;
    const d = INERTIA.wheelDPxPerFrame2;   // 0.3：滑得更久（刻意与卡片不同）

    const step = () => {
      if (Math.abs(v) < 1) {
        // 停下后一定吸附到刻度 —— 规则要求「绝不停在两格之间」
        const nearest = Math.round(-offset / ITEM_H);
        if (nearest < 0 || nearest >= items.length) {
          // 越界 → 回弹
          bounceTo(-Math.max(0, Math.min(items.length - 1, nearest)) * ITEM_H);
        } else {
          snapTo(nearest);
        }
        return;
      }
      apply(offset + v);
      v = v > 0 ? Math.max(0, v - d) : Math.min(0, v + d);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  };

  /* ---- 手势 ---- */
  let startY = 0, lastY = 0, lastT = 0, v = 0, dragging = false;

  pickerEl.addEventListener('pointerdown', (ev) => {
    dragging = true;
    startY = lastY = ev.clientY;
    lastT = performance.now();
    v = 0;
    if (raf) cancelAnimationFrame(raf);
    if (spring) spring.stop();
    pickerEl.setPointerCapture?.(ev.pointerId);
  });

  pickerEl.addEventListener('pointermove', (ev) => {
    if (!dragging) return;
    ev.preventDefault();

    const now = performance.now();
    const dt = Math.max(1, now - lastT);
    v = (ev.clientY - lastY) / dt * 16;    // 换算成 px/frame
    lastY = ev.clientY;
    lastT = now;

    // 跟手位移：从该次拖拽的起点算起，允许轻微越界（回弹的弹性来源）
    const target = -index * ITEM_H + (ev.clientY - startY);
    const minY = -(items.length - 1) * ITEM_H - ITEM_H * 0.4;
    const maxY = ITEM_H * 0.4;
    apply(Math.max(minY, Math.min(maxY, target)));
  }, { passive: false });

  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    if (Math.abs(v) > 0.8) fling(v);
    else {
      const nearest = Math.round(-offset / ITEM_H);
      if (nearest < 0 || nearest >= items.length) {
        bounceTo(-Math.max(0, Math.min(items.length - 1, nearest)) * ITEM_H);
      } else snapTo(nearest);
    }
  };

  pickerEl.addEventListener('pointerup', endDrag);
  pickerEl.addEventListener('pointercancel', endDrag);

  apply(0);
  return { get value() { return items[index]; }, snapTo };
}

/* =====================================================================
 * 7. 守卫：清理残留的入场动画
 *
 * #app.is-entering 上挂着 appEnter 动画，它的关键帧包含 transform。
 * 动画的 transform 优先级高于一切声明（包括内联 !important），
 * 只要它还在「running」或带 fill 残留，按钮等子元素的 transform 就会全部失效。
 * 这里监听动画真正结束，立刻摘掉类，保证后续交互不受压制。
 * ===================================================================== */
function guardAppEnter() {
  const app = $('#app');
  if (!app) return;

  const cleanup = () => {
    app.classList.remove('is-entering');
    app.classList.add('is-entered');
  };

  if (app.classList.contains('is-entering')) {
    const anims = app.getAnimations ? app.getAnimations() : [];
    const enterAnim = anims.find((a) => a.animationName === 'appEnter');

    if (enterAnim) {
      // 动画真正播完（或被取消）时清理
      enterAnim.finished ? enterAnim.finished.then(cleanup).catch(cleanup) : null;
    }

    // 兜底：无论动画是否触发，1.9s 后一定清理（延迟 900 + 时长 760 + 余量）
    setTimeout(cleanup, 1900);
  }

  // 极端兜底：页面隐藏/恢复时若仍残留，直接清掉
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      const a = app.getAnimations ? app.getAnimations() : [];
      if (!a.some((x) => x.playState === 'running')) cleanup();
    }
  });
}

/* =====================================================================
 * 8. 挂载
 * ===================================================================== */
function initInteractions() {
  // 2.1 完成反馈按钮（三类表单都挂）
  $$('.entry-form').forEach(attachCompleteFeedback);

  // 分类标签的物理选中反馈
  attachChipPhysics();

  // 页面切换：轻量位移淡入（替代原先的 clip-path 扩散）
  attachPageTransition();

  // 2.3 洞察卡展开
  attachInsightExpand();

  // 清理入场动画残留，避免压制子元素 transform
  guardAppEnter();
}

initInteractions();
