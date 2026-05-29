const navWrap = document.querySelector('.nav-wrap');
const menu = document.querySelector('.menu');
const links = document.querySelector('.nav-links');
const year = document.querySelector('[data-year]');

if (year) year.textContent = new Date().getFullYear();

function scrolled() {
  if (!navWrap) return;
  navWrap.classList.toggle('scrolled', window.scrollY > 16);
  const scrollable = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
  const progress = Math.min(100, Math.max(0, (window.scrollY / scrollable) * 100));
  navWrap.style.setProperty('--scroll-progress', `${progress}%`);
}
scrolled();
window.addEventListener('scroll', scrolled, { passive: true });
window.addEventListener('resize', scrolled, { passive: true });

// v29 mobile navigation: fixed, modal-like, scroll-safe, and intentionally animated.
// It locks the page behind the menu so cards/hero elements cannot visually pass over it.
let mobileNavScrim = null;
let lockedScrollY = 0;

function ensureMobileNavScrim() {
  if (mobileNavScrim) return mobileNavScrim;
  mobileNavScrim = document.createElement('button');
  mobileNavScrim.type = 'button';
  mobileNavScrim.className = 'mobile-nav-scrim';
  mobileNavScrim.setAttribute('aria-label', 'Close navigation menu');
  mobileNavScrim.hidden = true;
  document.body.appendChild(mobileNavScrim);
  mobileNavScrim.addEventListener('click', closeMobileNav);
  return mobileNavScrim;
}

function lockPageScroll() {
  lockedScrollY = window.scrollY || document.documentElement.scrollTop || 0;
  document.documentElement.classList.add('nav-open');
  document.body.classList.add('nav-open');
  document.body.style.setProperty('--locked-scroll-y', `-${lockedScrollY}px`);
  document.body.style.position = 'fixed';
  document.body.style.top = `-${lockedScrollY}px`;
  document.body.style.left = '0';
  document.body.style.right = '0';
  document.body.style.width = '100%';
}

function unlockPageScroll() {
  document.documentElement.classList.remove('nav-open');
  document.body.classList.remove('nav-open');
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.left = '';
  document.body.style.right = '';
  document.body.style.width = '';
  document.body.style.removeProperty('--locked-scroll-y');
  window.scrollTo(0, lockedScrollY);
}

function closeMobileNav() {
  if (!links || !menu) return;
  links.classList.remove('open');
  if (navWrap) navWrap.classList.remove('menu-open');
  menu.setAttribute('aria-expanded', 'false');
  menu.setAttribute('aria-label', 'Open navigation menu');
  menu.textContent = 'Menu';
  links.setAttribute('aria-hidden', window.innerWidth <= 900 ? 'true' : 'false');
  if (mobileNavScrim) {
    mobileNavScrim.classList.remove('is-visible');
    window.setTimeout(() => {
      if (!links.classList.contains('open')) mobileNavScrim.hidden = true;
    }, 220);
  }
  if (document.body.classList.contains('nav-open')) unlockPageScroll();
}

if (menu && links) {
  menu.setAttribute('aria-label', 'Open navigation menu');
  const syncNavAria = () => {
    links.setAttribute('aria-hidden', window.innerWidth <= 900 && !links.classList.contains('open') ? 'true' : 'false');
  };
  syncNavAria();

  const openMobileNav = () => {
    const scrim = ensureMobileNavScrim();
    scrim.hidden = false;
    requestAnimationFrame(() => scrim.classList.add('is-visible'));
    links.classList.add('open');
    links.setAttribute('aria-hidden', 'false');
    if (navWrap) navWrap.classList.add('menu-open');
    menu.setAttribute('aria-expanded', 'true');
    menu.setAttribute('aria-label', 'Close navigation menu');
    menu.textContent = 'Close';
    lockPageScroll();
  };

  const toggleMobileNav = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (links.classList.contains('open')) closeMobileNav();
    else openMobileNav();
  };

  menu.addEventListener('click', toggleMobileNav);

  links.querySelectorAll('a').forEach((anchor) => {
    anchor.addEventListener('click', (event) => {
      const href = anchor.getAttribute('href');
      if (!href) return;
      const target = new URL(href, window.location.href);
      event.preventDefault();
      event.stopPropagation();
      closeMobileNav();
      window.setTimeout(() => {
        if (target.pathname === window.location.pathname && target.hash) {
          window.location.hash = target.hash;
        } else if (target.href !== window.location.href) {
          window.location.assign(target.href);
        }
      }, 24);
    });
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMobileNav();
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 900) closeMobileNav();
    syncNavAria();
  }, { passive: true });
}

document.querySelectorAll('[data-magnetic]').forEach((el) => {
  el.addEventListener('mousemove', (event) => {
    const rect = el.getBoundingClientRect();
    const x = event.clientX - rect.left - rect.width / 2;
    const y = event.clientY - rect.top - rect.height / 2;
    el.style.transform = `translate(${x * 0.025}px, ${y * 0.04}px) rotate(-3deg)`;
  });
  el.addEventListener('mouseleave', () => {
    el.style.transform = '';
  });
});

const reveal = document.querySelectorAll('[data-reveal]');
if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      entry.target.animate(
        [
          { opacity: 0, transform: 'translateY(24px)' },
          { opacity: 1, transform: 'translateY(0)' },
        ],
        { duration: 520, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'forwards' }
      );
      io.unobserve(entry.target);
    });
  }, { threshold: 0.14 });

  reveal.forEach((el) => {
    el.style.opacity = 0;
    io.observe(el);
  });
}

// Reel Vault: end-aware player.
// Local MP4/WebM and direct Drive video streams move to the next reel only when the real media ends.
// If Google Drive blocks direct streaming, we fall back to Drive preview and keep it manual instead of cutting early.
(function reelVault() {
  const player = document.querySelector('[data-reel-player]');
  if (!player) return;

  const meta = document.querySelector('[data-reel-meta]');
  const strip = document.querySelector('[data-reel-strip]');
  const prev = document.querySelector('[data-reel-prev]');
  const next = document.querySelector('[data-reel-next]');
  const count = document.querySelector('[data-reel-count]');
  const state = document.querySelector('[data-reel-state]');
  const folder = window.RISEKLIX_PORTFOLIO_FOLDER || 'https://drive.google.com/drive/folders/1B0jFiVURGXHkuLzrDApdlou8Uop3_1U0';
  const rawVideos = Array.isArray(window.RISEKLIX_PORTFOLIO_VIDEOS) ? window.RISEKLIX_PORTFOLIO_VIDEOS : [];
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let active = 0;
  let currentMedia = null;
  let fallbackTimer = null;

  const escapeHTML = (value) => String(value || '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[char]));

  const extractDriveId = (value) => {
    if (!value) return '';
    const text = String(value).trim();
    const fileMatch = text.match(/\/file\/d\/([^/]+)/);
    if (fileMatch) return fileMatch[1];
    const idMatch = text.match(/[?&]id=([^&]+)/);
    if (idMatch) return idMatch[1];
    if (/^[a-zA-Z0-9_-]{20,}$/.test(text)) return text;
    return '';
  };

  const isDirectVideo = (value) => /\.(mp4|webm|mov)(\?.*)?$/i.test(String(value || ''));
  const inferType = (src) => {
    const clean = String(src || '').split('?')[0].toLowerCase();
    if (clean.endsWith('.webm')) return 'video/webm';
    if (clean.endsWith('.mov')) return 'video/quicktime';
    return 'video/mp4';
  };
  const drivePreviewSrc = (id) => `https://drive.google.com/file/d/${encodeURIComponent(id)}/preview`;
  const driveDirectSrc = (id) => `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`;

  const videos = rawVideos.map((video, index) => {
    const src = video.src || video.mp4 || video.localUrl || video.videoUrl || '';
    const driveId = extractDriveId(video.driveUrl || video.url || video.driveId || video.id);
    return {
      title: video.title || `Portfolio reel ${index + 1}`,
      label: video.label || video.type || 'Portfolio reel',
      note: video.note || 'Short-form editing, pacing, captions, and visual storytelling work by Riseklix.',
      src: isDirectVideo(src) ? src : '',
      poster: video.poster || '',
      driveId,
      embedOnly: Boolean(video.embedOnly),
    };
  }).filter((video) => video.src || video.driveId);

  const placeholders = [
    { title: 'Reel Loop Ready', label: 'Live deck', note: 'Add local MP4s for perfect end-detection or keep Drive previews as manual fallbacks.' },
    { title: 'Creator edits', label: 'Slot 02', note: 'Drop in vertical edits for founder, creator, podcast, or brand work.' },
    { title: 'Motion captions', label: 'Slot 03', note: 'Use this slot for typography-heavy edits and retention captions.' },
    { title: 'Campaign cuts', label: 'Slot 04', note: 'Add launch, offer, or brand-campaign clips to make the proof feel alive.' },
  ];
  const items = videos.length ? videos : placeholders;

  function clearFallbackTimer() {
    if (fallbackTimer) {
      window.clearTimeout(fallbackTimer);
      fallbackTimer = null;
    }
  }

  function go(step) {
    if (items.length < 1) return;
    clearFallbackTimer();
    active = (active + step + items.length) % items.length;
    render();
  }

  function updateMeta(item) {
    if (meta) {
      meta.innerHTML = `<div><h3>${escapeHTML(item.title)}</h3><p>${escapeHTML(item.note)}</p></div><span class="reel-badge">${escapeHTML(item.label)}</span>`;
    }
    if (count) count.textContent = `${active + 1} / ${items.length}`;
    if (strip) {
      strip.innerHTML = items.map((thumb, i) => `
        <button class="reel-thumb ${i === active ? 'is-active' : ''}" type="button" data-reel-index="${i}" aria-label="Show ${escapeHTML(thumb.title)}">
          <span>${escapeHTML(thumb.label)}</span>
          <strong>${escapeHTML(thumb.title)}</strong>
        </button>
      `).join('');
      strip.querySelectorAll('[data-reel-index]').forEach((btn) => {
        btn.addEventListener('click', () => {
          active = Number(btn.dataset.reelIndex);
          render();
        });
      });
    }
  }

  function setState(message) {
    if (state) state.textContent = message;
  }

  function renderIframeFallback(item) {
    currentMedia = null;
    clearFallbackTimer();
    player.innerHTML = `
      <iframe src="${drivePreviewSrc(item.driveId)}" loading="lazy" allow="autoplay; fullscreen" allowfullscreen title="${escapeHTML(item.title)}"></iframe>
      <span class="reel-live-pill">Drive preview</span>
      <span class="reel-fallback-note">Use arrows after the reel finishes</span>
    `;
    setState('Drive preview mode. Use the arrows to move through the portfolio without extra thumbnail buttons.');
  }

  function renderNativeVideo(item, src, type) {
    const poster = item.poster ? ` poster="${escapeHTML(item.poster)}"` : '';
    player.innerHTML = `
      <video class="reel-video" autoplay muted playsinline controls preload="metadata"${poster} title="${escapeHTML(item.title)}">
        <source src="${escapeHTML(src)}" type="${type}">
        Your browser does not support this video.
      </video>
      <span class="reel-live-pill">End-aware loop</span>
      <span class="reel-progress" aria-hidden="true"><i></i></span>
    `;

    const video = player.querySelector('video');
    const progress = player.querySelector('.reel-progress i');
    currentMedia = video;

    if (!video) return;

    let hasStarted = false;
    let fellBack = false;

    const fallbackToDrivePreview = () => {
      if (!item.driveId || item.src || fellBack) return;
      fellBack = true;
      renderIframeFallback(item);
    };

    video.addEventListener('loadedmetadata', () => {
      hasStarted = true;
      clearFallbackTimer();
      const duration = Number.isFinite(video.duration) ? Math.round(video.duration) : null;
      setState(duration ? `Playing ${active + 1} of ${items.length}. Next starts after this ${duration}s clip ends.` : 'Playing. It changes only when the clip ends.');
    });

    video.addEventListener('timeupdate', () => {
      if (!progress || !Number.isFinite(video.duration) || video.duration <= 0) return;
      progress.style.width = `${Math.min(100, (video.currentTime / video.duration) * 100)}%`;
    });

    video.addEventListener('ended', () => {
      if (progress) progress.style.width = '100%';
      if (!reduceMotion && items.length > 1) {
        go(1);
      } else {
        video.currentTime = 0;
        video.play().catch(() => setState('Tap play once to restart the reel.'));
      }
    });

    video.addEventListener('error', () => {
      clearFallbackTimer();
      if (item.driveId && !item.src) {
        fallbackToDrivePreview();
      } else {
        setState('This reel could not load. Use the arrows to move to the next piece.');
      }
    });

    if (item.driveId && !item.src) {
      fallbackTimer = window.setTimeout(() => {
        if (!hasStarted && video.readyState === 0) fallbackToDrivePreview();
      }, 9000);
    }

    video.play().catch(() => {
      setState('Autoplay was blocked by the browser. Tap play once; after that the deck advances only when the reel ends.');
    });
  }

  function renderPlaceholder(item) {
    currentMedia = null;
    clearFallbackTimer();
    player.innerHTML = `
      <div class="reel-empty">
        <div class="reel-orbit" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
        <div class="reel-empty-inner">
          <span class="giant">REEL<br>LOOP</span>
          <p>Your Drive folder stays below as the archive. Add individual Drive links or local MP4s to make this hero area loop like a living portfolio wall.</p>
          <a class="mini-link" href="${escapeHTML(folder)}" target="_blank" rel="noopener">Open folder ↗</a>
        </div>
      </div>
    `;
    setState('Ready for reels. Add local MP4s for perfect end-aware autoplay.');
  }

  function render() {
    clearFallbackTimer();
    const item = items[active];
    updateMeta(item);

    if (item.src) {
      renderNativeVideo(item, item.src, inferType(item.src));
      return;
    }

    if (item.driveId && !item.embedOnly) {
      renderNativeVideo(item, driveDirectSrc(item.driveId), 'video/mp4');
      return;
    }

    if (item.driveId) {
      renderIframeFallback(item);
      return;
    }

    renderPlaceholder(item);
  }

  player.addEventListener('mouseenter', () => {
    if (currentMedia && !currentMedia.paused) currentMedia.pause();
  });
  player.addEventListener('mouseleave', () => {
    if (currentMedia && currentMedia.paused && !currentMedia.ended) {
      currentMedia.play().catch(() => {});
    }
  });

  if (prev) prev.addEventListener('click', () => go(-1));
  if (next) next.addEventListener('click', () => go(1));

  render();
})();

// v18 micro-interaction layer: pointer spotlight + button tap confirmation.
(() => {
  const canHover = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const surfaces = document.querySelectorAll('.card, .case, .process-item, .metric, .tagbox, .reel-card, .drive-vault, .manifesto-board');
  surfaces.forEach((surface) => {
    surface.classList.add('is-micro-surface');
    if (!surface.querySelector(':scope > .micro-glow')) {
      const glow = document.createElement('span');
      glow.className = 'micro-glow';
      glow.setAttribute('aria-hidden', 'true');
      surface.appendChild(glow);
    }
    if (!canHover) return;
    surface.addEventListener('pointermove', (event) => {
      const rect = surface.getBoundingClientRect();
      surface.style.setProperty('--mx', `${event.clientX - rect.left}px`);
      surface.style.setProperty('--my', `${event.clientY - rect.top}px`);
    }, { passive: true });
  });

  document.querySelectorAll('.btn').forEach((button) => {
    button.addEventListener('click', (event) => {
      const rect = button.getBoundingClientRect();
      const ripple = document.createElement('span');
      ripple.className = 'btn-ripple';
      ripple.style.left = `${event.clientX - rect.left}px`;
      ripple.style.top = `${event.clientY - rect.top}px`;
      button.appendChild(ripple);
      window.setTimeout(() => ripple.remove(), 650);
    });
  });
})();


// v19 lightweight scroll theatre: word reveal + section entrance without scroll listeners.
(() => {
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion || !('IntersectionObserver' in window)) return;

  const splitTargets = Array.from(document.querySelectorAll('.display, .xl'))
    .filter((el) => !el.dataset.motionSplit && el.textContent.trim().length < 120 && !el.closest('.footer'));

  splitTargets.forEach((el) => {
    const words = el.textContent.trim().split(/\s+/);
    el.dataset.motionSplit = 'true';
    el.innerHTML = words.map((word, i) => `<span class="motion-word" style="--i:${i}">${word}</span>`).join(' ');
  });

  document.querySelectorAll('.card, .case, .process-item, .tagbox, .reel-card, .drive-vault, .manifesto-board, .kpi, .form, .calendly-card')
    .forEach((el) => el.classList.add('scroll-scene'));

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.16, rootMargin: '0px 0px -8% 0px' });

  document.querySelectorAll('[data-motion-split="true"], .scroll-scene').forEach((el) => observer.observe(el));


  // Safety: never leave split headlines blurred if a browser delays IntersectionObserver.
  window.setTimeout(() => {
    document.querySelectorAll('[data-motion-split="true"]').forEach((el) => el.classList.add('is-visible'));
  }, 900);

})();

// v33 Riseklix OS console: press-start zoom, playful apps, clean exit.
(() => {
  const osData = {
    lab: {
      heading: 'Campaign Lab',
      copy: 'Turn one raw idea into a hook map, a reel, a carousel, an ad angle, and a follow-up message before lunch.',
      a: 'Hook strength: 94%',
      b: 'Pipeline mood: warm',
      terminal: ['> booting taste layer...', '> extracting proof...', '> shipping assets to market.']
    },
    radar: {
      heading: 'Lead Radar',
      copy: 'Scan the market for people already showing buying intent, then warm them with content before outreach lands.',
      a: 'Reply heat: rising',
      b: 'Cold feels: 0%',
      terminal: ['> reading comments...', '> mapping founders...', '> warming the next call.']
    },
    vault: {
      heading: 'Reel Vault',
      copy: 'Drop long-form clips, podcasts, and founder ideas into the machine. Get short-form assets designed for retention.',
      a: 'Scroll-stop score: high',
      b: 'Clip fatigue: blocked',
      terminal: ['> trimming dead air...', '> caption punch loaded...', '> motion layer active.']
    },
    money: {
      heading: 'Money Meter',
      copy: 'Connect impressions to offers, ads, booking pages, and follow-up so attention has a direct revenue path.',
      a: 'Offer clarity: locked',
      b: 'Revenue path: visible',
      terminal: ['> counting warm leads...', '> pricing page detected...', '> closing loop complete.']
    }
  };

  const root = document.querySelector('[data-pixel-console]');
  const modal = document.querySelector('[data-rk-os]');
  if (!root || !modal) return;

  const startButton = root.querySelector('[data-os-open]');
  const scene = root.querySelector('.pixel-scene');
  const closeControls = modal.querySelectorAll('[data-os-close]');
  const apps = modal.querySelectorAll('[data-os-app]');
  const heading = modal.querySelector('[data-os-heading]');
  const copy = modal.querySelector('[data-os-copy]');
  const metricA = modal.querySelector('[data-os-metric-a]');
  const metricB = modal.querySelector('[data-os-metric-b]');
  const terminal = modal.querySelector('[data-os-terminal]');
  let lastFocus = null;
  let exitTimer = null;

  const restartConsoleBurst = () => {
    if (!scene) return;
    scene.classList.remove('play');
    void scene.offsetWidth;
    scene.classList.add('play');
  };

  const renderApp = (key) => {
    const data = osData[key] || osData.lab;
    apps.forEach((app) => app.classList.toggle('is-active', app.dataset.osApp === key));
    heading.textContent = data.heading;
    copy.textContent = data.copy;
    metricA.textContent = data.a;
    metricB.textContent = data.b;
    terminal.innerHTML = data.terminal.join('<br/>');
    terminal.classList.remove('pulse');
    void terminal.offsetWidth;
    terminal.classList.add('pulse');
  };

  const openOS = () => {
    lastFocus = document.activeElement;
    window.clearTimeout(exitTimer);
    restartConsoleBurst();
    // Move the OS modal to <body> before opening so fixed positioning is based on
    // the viewport, not the transformed/overflow-hidden hero artwork container.
    if (modal.parentElement !== document.body) {
      document.body.appendChild(modal);
    }
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('rk-os-open');
    requestAnimationFrame(() => {
      modal.classList.add('is-open');
      renderApp('lab');
      const first = modal.querySelector('.os-app.is-active') || modal.querySelector('button, a');
      if (first) first.focus({ preventScroll: true });
    });
  };

  const closeOS = () => {
    modal.classList.add('is-exiting');
    modal.classList.remove('is-open');
    exitTimer = window.setTimeout(() => {
      modal.hidden = true;
      modal.classList.remove('is-exiting');
      modal.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('rk-os-open');
      restartConsoleBurst();
      if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus({ preventScroll: true });
    }, 340);
  };

  startButton?.addEventListener('click', openOS);
  closeControls.forEach((control) => control.addEventListener('click', closeOS));
  apps.forEach((app) => app.addEventListener('click', () => renderApp(app.dataset.osApp)));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modal.hidden) closeOS();
  });
})();

// v35 desktop-only pixel firefly. Tiny, decorative, cursor-aware, and CTA-curious.
(() => {
  const canRun = window.matchMedia('(min-width: 1024px) and (pointer: fine)').matches;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!canRun || reduceMotion) return;

  const bug = document.createElement('span');
  bug.className = 'pixel-firefly';
  bug.setAttribute('aria-hidden', 'true');
  document.body.appendChild(bug);

  const state = {
    x: Math.max(120, window.innerWidth * 0.72),
    y: Math.max(120, window.innerHeight * 0.32),
    vx: 0,
    vy: 0,
    tx: window.innerWidth * 0.76,
    ty: window.innerHeight * 0.34,
    mouseX: null,
    mouseY: null,
    mode: 'wander',
    nextDecision: 0,
    perchUntil: 0,
    targetEl: null,
    lastTime: performance.now()
  };

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const visibleRect = (el) => {
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width < 24 || rect.height < 24) return null;
    if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) return null;
    return rect;
  };

  const getStrategyButtons = () => Array.from(document.querySelectorAll('a[href*="#book-call"], a[href*="/contact#book-call"], .nav-cta .btn'))
    .filter((el) => /strategy|book/i.test(el.textContent || '') && visibleRect(el));

  const pickWanderTarget = () => {
    state.mode = 'wander';
    state.targetEl = null;
    state.tx = clamp(80 + Math.random() * (window.innerWidth - 160), 40, window.innerWidth - 40);
    state.ty = clamp(80 + Math.random() * (window.innerHeight - 180), 62, window.innerHeight - 62);
    state.nextDecision = performance.now() + 1800 + Math.random() * 2400;
  };

  const perchOnButton = (button) => {
    const rect = visibleRect(button);
    if (!rect) return false;
    state.mode = 'perch';
    state.targetEl = button;
    state.tx = rect.left + rect.width - 12;
    state.ty = rect.top + Math.min(18, rect.height * 0.45);
    state.perchUntil = performance.now() + 2100 + Math.random() * 1400;
    state.nextDecision = state.perchUntil;
    bug.classList.add('is-perched');
    return true;
  };

  const decide = () => {
    const buttons = getStrategyButtons();
    if (buttons.length && Math.random() > 0.34) {
      const preferred = buttons.find((btn) => btn.closest('.hero, .nav-wrap, .footer-cta, .contact-card')) || buttons[0];
      if (perchOnButton(preferred)) return;
    }
    bug.classList.remove('is-perched');
    pickWanderTarget();
  };

  window.addEventListener('mousemove', (event) => {
    state.mouseX = event.clientX;
    state.mouseY = event.clientY;
  }, { passive: true });

  window.addEventListener('mouseleave', () => {
    state.mouseX = null;
    state.mouseY = null;
  }, { passive: true });

  window.addEventListener('scroll', () => {
    if (state.mode === 'perch' && state.targetEl) {
      const rect = visibleRect(state.targetEl);
      if (rect) {
        state.tx = rect.left + rect.width - 12;
        state.ty = rect.top + Math.min(18, rect.height * 0.45);
      } else {
        bug.classList.remove('is-perched');
        pickWanderTarget();
      }
    }
  }, { passive: true });

  const frame = (now) => {
    const dt = Math.min(32, now - state.lastTime) / 16.67;
    state.lastTime = now;

    if (now > state.nextDecision) {
      if (state.mode === 'perch' && now < state.perchUntil) {
        // keep resting
      } else {
        decide();
      }
    }

    if (state.mode === 'perch' && state.targetEl) {
      const rect = visibleRect(state.targetEl);
      if (rect) {
        state.tx = rect.left + rect.width - 12;
        state.ty = rect.top + Math.min(18, rect.height * 0.45);
      }
    }

    let ax = (state.tx - state.x) * 0.012;
    let ay = (state.ty - state.y) * 0.012;

    if (state.mouseX !== null && state.mode !== 'perch') {
      const dx = state.x - state.mouseX;
      const dy = state.y - state.mouseY;
      const d2 = dx * dx + dy * dy;
      const avoidRadius = 116;
      if (d2 < avoidRadius * avoidRadius && d2 > 1) {
        const d = Math.sqrt(d2);
        const force = (avoidRadius - d) / avoidRadius;
        ax += (dx / d) * force * 1.35;
        ay += (dy / d) * force * 1.35;
      }
    }

    // Little organic flutter without changing layout.
    if (state.mode !== 'perch') {
      ax += Math.sin(now / 510) * 0.018;
      ay += Math.cos(now / 690) * 0.014;
    }

    const drag = state.mode === 'perch' ? 0.82 : 0.9;
    state.vx = (state.vx + ax * dt) * drag;
    state.vy = (state.vy + ay * dt) * drag;
    state.x = clamp(state.x + state.vx * dt, 16, window.innerWidth - 20);
    state.y = clamp(state.y + state.vy * dt, 62, window.innerHeight - 20);

    bug.style.transform = `translate3d(${state.x}px, ${state.y}px, 0)`;
    requestAnimationFrame(frame);
  };

  setTimeout(() => {
    bug.classList.add('is-live');
    decide();
    requestAnimationFrame(frame);
  }, 900);
})();
