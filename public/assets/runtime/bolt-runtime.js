/*
 * Bolt IA · runtime de componentes interativos. Código próprio, sem dependências.
 * Nunca executa conteúdo do documento: só lê atributos data-bolt-* e manipula classes,
 * atributos ARIA e uma folha de estilos própria por carrossel.
 *
 * Modos (atributo data-mode do <script>): "editor" (canvas do Bolt), "preview" (prévia) ou
 * "site" (página exportada). No editor não há autoplay nem clones, para não interferir na edição.
 */
(function () {
  'use strict';
  if (window.__boltRuntime) return;
  var doc = document;
  var script = doc.currentScript;
  var mode = (script && script.getAttribute('data-mode')) || 'site';
  var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  doc.documentElement.setAttribute('data-bolt-mode', mode);

  function closest(el, selector) {
    while (el && el.nodeType === 1) {
      if (el.matches(selector)) return el;
      el = el.parentElement;
    }
    return null;
  }

  // ---------------------------------------------------------------- menu móvel
  function toggleMenu(toggle, force) {
    var root = closest(toggle, '[data-bolt-type="menu"]');
    if (!root) return;
    var open = typeof force === 'boolean' ? force : !root.hasAttribute('data-bolt-menu-open');
    if (open) root.setAttribute('data-bolt-menu-open', '');
    else root.removeAttribute('data-bolt-menu-open');
    var toggles = root.querySelectorAll('[data-bolt-type="menu-toggle"]');
    for (var i = 0; i < toggles.length; i++) toggles[i].setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  // Fase de captura: o canvas do editor interrompe a propagação dos cliques (seleção).
  doc.addEventListener('click', function (ev) {
    var t = ev.target;
    // Pré-visualização: ligações para páginas do projeto («/slug») não navegam no iframe (que
    // abriria rotas da aplicação); o editor mostra a página pedida. Âncoras (#) e endereços
    // externos mantêm o comportamento habitual. No canvas (modo editor) nada disto se aplica.
    if (mode === 'preview') {
      var anchor = closest(t, 'a[href]');
      var target = anchor ? anchor.getAttribute('href') || '' : '';
      if (target.charAt(0) === '/' && target.charAt(1) !== '/') {
        ev.preventDefault();
        if (window.parent && window.parent !== window) window.parent.postMessage({ bolt: 'navigate', href: target }, '*');
        return;
      }
      // Âncora: num documento srcdoc o «#» resolveria contra o endereço da aplicação e o iframe
      // sairia da página. Faz-se o deslocamento que uma âncora faz numa página publicada.
      if (target.charAt(0) === '#') {
        ev.preventDefault();
        var id;
        try {
          id = decodeURIComponent(target.slice(1));
        } catch {
          id = target.slice(1);
        }
        var dest = id ? doc.getElementById(id) : null;
        if (dest) dest.scrollIntoView({ behavior: 'smooth', block: 'start' });
        else if (!id) window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
    }
    var toggle = closest(t, '[data-bolt-type="menu-toggle"]');
    if (toggle) {
      toggleMenu(toggle);
      return;
    }
    if (mode !== 'editor') {
      var link = closest(t, '[data-bolt-type="menu"] a[href]');
      var menu = link && closest(link, '[data-bolt-type="menu"]');
      if (menu && menu.hasAttribute('data-bolt-menu-open')) toggleMenu(link, false);
    }
    var arrow = closest(t, '[data-bolt-type="carousel-prev"], [data-bolt-type="carousel-next"]');
    if (arrow) {
      var c = carouselOf(arrow);
      if (c) c.step(arrow.getAttribute('data-bolt-type') === 'carousel-next' ? 1 : -1);
      return;
    }
    var bullet = closest(t, '[data-bolt-bullet]');
    if (bullet) {
      var cb = carouselOf(bullet);
      if (cb) cb.go(Number(bullet.getAttribute('data-bolt-bullet')), true);
    }
  }, true);

  doc.addEventListener('keydown', function (ev) {
    // Na pré-visualização, Escape com o foco dentro do iframe chega à janela-mãe (que decide).
    if (ev.key === 'Escape' && mode === 'preview' && window.parent && window.parent !== window) {
      window.parent.postMessage({ bolt: 'escape' }, '*');
      return;
    }
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    var t = ev.target;
    if (!t || !t.matches) return;
    if (t.matches('[data-bolt-type="menu-toggle"], [data-bolt-type="carousel-prev"], [data-bolt-type="carousel-next"], [data-bolt-bullet]')) {
      ev.preventDefault();
      t.click();
    }
  }, true);

  // ---------------------------------------------------------------- carrossel
  var instances = [];
  var uid = 0;

  function carouselOf(el) {
    var root = closest(el, '[data-bolt-type="carousel"]');
    return root ? root.__boltCarousel || null : null;
  }

  function parseConfig(root) {
    var cfg;
    try {
      cfg = JSON.parse(root.getAttribute('data-bolt-carousel') || '{}') || {};
    } catch {
      cfg = {};
    }
    var bps = Array.isArray(cfg.breakpoints) && cfg.breakpoints.length ? cfg.breakpoints : [{ min: 0, perView: 1, gap: 0 }];
    bps = bps
      .map(function (b) {
        return { min: Number(b.min) || 0, perView: Math.max(1, Number(b.perView) || 1), gap: Math.max(0, Number(b.gap) || 0) };
      })
      .sort(function (a, b) {
        return a.min - b.min;
      });
    return {
      breakpoints: bps,
      loop: !!cfg.loop,
      autoplay: cfg.autoplay && typeof cfg.autoplay.delay === 'number' ? { delay: Math.max(0, cfg.autoplay.delay) } : null,
      speed: Math.max(0, Number(cfg.speed) || 300),
      easing: cfg.easing === 'linear' ? 'linear' : 'ease',
      pagination: cfg.pagination !== false,
      pauseOnHover: cfg.pauseOnHover !== false,
      reverse: cfg.reverse === true,
    };
  }

  function Carousel(root) {
    this.root = root;
    this.index = 0;
    this.offset = 0;
    this.styleEl = doc.createElement('style');
    this.styleEl.setAttribute('data-bolt-runtime', '');
    (doc.head || doc.documentElement).appendChild(this.styleEl);
    if (!root.id) root.id = 'bolt-carousel-' + ++uid;
    root.__boltCarousel = this;
    this.hover = false;
    var self = this;
    root.addEventListener('mouseenter', function () { self.hover = true; });
    root.addEventListener('mouseleave', function () { self.hover = false; });
    this.bindSwipe();
    this.refresh();
    if (window.ResizeObserver) {
      this.ro = new ResizeObserver(function () { self.layout(false); });
      this.ro.observe(root);
    } else {
      window.addEventListener('resize', function () { self.layout(false); });
    }
  }

  Carousel.prototype.track = function () {
    var kids = this.root.children;
    for (var i = 0; i < kids.length; i++) if (kids[i].getAttribute('data-bolt-type') === 'carousel-track') return kids[i];
    return null;
  };

  Carousel.prototype.slides = function () {
    var track = this.track();
    if (!track) return [];
    return Array.prototype.filter.call(track.children, function (c) {
      return !c.hasAttribute('data-bolt-clone');
    });
  };

  Carousel.prototype.current = function () {
    var w = window.innerWidth;
    var chosen = this.cfg.breakpoints[0];
    for (var i = 0; i < this.cfg.breakpoints.length; i++) if (w >= this.cfg.breakpoints[i].min) chosen = this.cfg.breakpoints[i];
    return chosen;
  };

  Carousel.prototype.refresh = function () {
    this.cfg = parseConfig(this.root);
    this.removeClones();
    this.marquee = !!(this.cfg.autoplay && this.cfg.autoplay.delay === 0 && mode !== 'editor' && !reduceMotion);
    if (this.marquee) this.addClones();
    this.layout(false);
    this.setupAutoplay();
  };

  Carousel.prototype.removeClones = function () {
    var track = this.track();
    if (!track) return;
    var clones = track.querySelectorAll(':scope > [data-bolt-clone]');
    for (var i = 0; i < clones.length; i++) clones[i].remove();
  };

  Carousel.prototype.addClones = function () {
    var track = this.track();
    var slides = this.slides();
    for (var i = 0; i < slides.length; i++) {
      var copy = slides[i].cloneNode(true);
      copy.setAttribute('data-bolt-clone', '');
      copy.setAttribute('aria-hidden', 'true');
      copy.removeAttribute('id');
      var ids = copy.querySelectorAll('[id]');
      for (var j = 0; j < ids.length; j++) ids[j].removeAttribute('id');
      track.appendChild(copy);
    }
  };

  Carousel.prototype.layout = function (animate) {
    var bp = this.current();
    var count = this.slides().length;
    var width = this.root.clientWidth;
    this.perView = Math.min(bp.perView, Math.max(1, count));
    this.gap = bp.gap;
    this.slideWidth = Math.max(0, (width - this.gap * (this.perView - 1)) / this.perView);
    this.maxIndex = Math.max(0, count - this.perView);
    if (this.index > this.maxIndex && !this.cfg.loop) this.index = this.maxIndex;
    this.renderBullets(count);
    this.apply(animate);
  };

  Carousel.prototype.apply = function (animate) {
    var id = '#' + (window.CSS && CSS.escape ? CSS.escape(this.root.id) : this.root.id);
    var step = this.slideWidth + this.gap;
    var setWidth = step * this.slides().length;
    // Em sentido inverso a faixa desloca-se para a direita (a mesma sequência, ao contrário).
    var x = this.marquee ? (this.cfg.reverse && setWidth > 0 ? setWidth - this.offset : this.offset) : this.index * step;
    var transition = animate && !reduceMotion ? 'transform ' + this.cfg.speed + 'ms ' + this.cfg.easing : 'none';
    this.styleEl.textContent =
      id + ' > [data-bolt-type="carousel-track"]{transform:translate3d(' + -x + 'px,0,0);transition:' + transition + '}' +
      id + ' > [data-bolt-type="carousel-track"] > *{width:' + this.slideWidth + 'px;margin-right:' + this.gap + 'px}';
    this.updateControls();
  };

  Carousel.prototype.go = function (i, animate) {
    var count = this.slides().length;
    if (!count) return;
    if (this.cfg.loop) {
      if (i > this.maxIndex) i = 0;
      if (i < 0) i = this.maxIndex;
    } else {
      i = Math.max(0, Math.min(this.maxIndex, i));
    }
    this.index = i;
    this.apply(animate !== false);
  };

  Carousel.prototype.step = function (d) {
    this.go(this.index + d, true);
  };

  Carousel.prototype.renderBullets = function () {
    var pag = null;
    var kids = this.root.children;
    for (var i = 0; i < kids.length; i++) if (kids[i].getAttribute('data-bolt-type') === 'carousel-pagination') pag = kids[i];
    this.pagination = pag;
    if (!pag) return;
    var old = pag.querySelectorAll('[data-bolt-bullet]');
    for (var k = 0; k < old.length; k++) old[k].remove();
    if (!this.cfg.pagination || this.marquee) return;
    var n = this.maxIndex + 1;
    for (var b = 0; b < n && n > 1; b++) {
      var dot = doc.createElement('span');
      dot.setAttribute('data-bolt-bullet', String(b));
      dot.setAttribute('role', 'button');
      dot.setAttribute('tabindex', '0');
      dot.setAttribute('aria-label', 'Ir para o slide ' + (b + 1));
      pag.appendChild(dot);
    }
  };

  Carousel.prototype.updateControls = function () {
    if (this.pagination) {
      var dots = this.pagination.querySelectorAll('[data-bolt-bullet]');
      for (var i = 0; i < dots.length; i++) dots[i].setAttribute('aria-current', i === this.index ? 'true' : 'false');
    }
    var kids = this.root.children;
    for (var j = 0; j < kids.length; j++) {
      var t = kids[j].getAttribute('data-bolt-type');
      if (t !== 'carousel-prev' && t !== 'carousel-next') continue;
      var atEnd = !this.cfg.loop && (t === 'carousel-prev' ? this.index <= 0 : this.index >= this.maxIndex);
      kids[j].setAttribute('aria-disabled', atEnd ? 'true' : 'false');
    }
  };

  Carousel.prototype.setupAutoplay = function () {
    var self = this;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
    if (!this.cfg.autoplay || mode === 'editor' || reduceMotion) return;
    if (this.marquee) {
      var last = 0;
      var tick = function (ts) {
        if (!last) last = ts;
        var dt = ts - last;
        last = ts;
        if (!(self.cfg.pauseOnHover && self.hover)) {
          var step = self.slideWidth + self.gap;
          var setWidth = step * self.slides().length;
          self.offset += (dt * step) / self.cfg.speed;
          if (setWidth > 0 && self.offset >= setWidth) self.offset -= setWidth;
          self.apply(false);
        }
        self.raf = requestAnimationFrame(tick);
      };
      this.raf = requestAnimationFrame(tick);
      return;
    }
    this.timer = setInterval(function () {
      if (self.cfg.pauseOnHover && self.hover) return;
      var next = self.index + 1;
      if (next > self.maxIndex) next = 0;
      self.go(next, true);
    }, Math.max(1000, this.cfg.autoplay.delay));
  };

  Carousel.prototype.bindSwipe = function () {
    if (mode === 'editor') return;
    var self = this;
    var startX = null;
    this.root.addEventListener('pointerdown', function (e) { startX = e.clientX; });
    this.root.addEventListener('pointerup', function (e) {
      if (startX === null) return;
      var dx = e.clientX - startX;
      startX = null;
      if (Math.abs(dx) > 40 && !self.marquee) self.step(dx < 0 ? 1 : -1);
    });
  };

  Carousel.prototype.show = function (el) {
    var slides = this.slides();
    for (var i = 0; i < slides.length; i++) {
      if (slides[i] === el || slides[i].contains(el)) {
        this.go(Math.min(i, this.maxIndex), true);
        return;
      }
    }
  };

  function scan() {
    var roots = doc.querySelectorAll('[data-bolt-type="carousel"]');
    for (var i = 0; i < roots.length; i++) {
      var r = roots[i];
      if (!r.__boltCarousel) instances.push(new Carousel(r));
      else r.__boltCarousel.refresh();
    }
    // Remove folhas de carrosséis que já não existem (ex.: eliminados no editor).
    instances = instances.filter(function (c) {
      if (doc.documentElement.contains(c.root)) return true;
      if (c.timer) clearInterval(c.timer);
      if (c.raf) cancelAnimationFrame(c.raf);
      if (c.ro) c.ro.disconnect();
      c.styleEl.remove();
      return false;
    });
  }

  // ---------------------------------------------------------------- prévia
  function previewNotices() {
    if (mode !== 'preview') return;
    var imgs = doc.querySelectorAll('img');
    var mark = function (img) {
      if (img.complete && img.naturalWidth === 0) img.setAttribute('data-bolt-missing', '');
    };
    for (var i = 0; i < imgs.length; i++) {
      mark(imgs[i]);
      imgs[i].addEventListener('error', function (e) { e.target.setAttribute('data-bolt-missing', ''); });
    }
    if (doc.querySelector('input, textarea, select, form')) {
      var n = doc.createElement('div');
      n.setAttribute('data-bolt-notice', '');
      n.innerHTML = '<strong>Formulário sem envio configurado.</strong> Os campos são editáveis, mas nada é enviado nem subscrito.';
      doc.body.appendChild(n);
    }
  }

  var pending = null;
  function schedule() {
    if (pending) return;
    pending = setTimeout(function () {
      pending = null;
      scan();
    }, 60);
  }

  /** Nós criados pelo próprio runtime (clones, pontos): mudá-los não pede nova análise. */
  function ownNode(n) {
    return n.nodeType === 1 && (n.hasAttribute('data-bolt-clone') || n.hasAttribute('data-bolt-bullet') || n.hasAttribute('data-bolt-notice'));
  }

  function relevant(m) {
    if (m.type === 'attributes') return true;
    var nodes = Array.prototype.slice.call(m.addedNodes).concat(Array.prototype.slice.call(m.removedNodes));
    if (!nodes.length) return false;
    for (var i = 0; i < nodes.length; i++) if (!ownNode(nodes[i])) return true;
    return false;
  }

  function start() {
    scan();
    previewNotices();
    // Pré-visualização com foco (ex.: antes/depois do assistente): mostra o elemento em causa.
    var focus = mode === 'preview' && doc.body ? doc.body.getAttribute('data-bolt-focus') : null;
    var target = focus ? doc.getElementById(focus) : null;
    if (target) target.scrollIntoView({ block: 'center' });
    if (window.MutationObserver) {
      new MutationObserver(function (list) {
        for (var i = 0; i < list.length; i++) {
          if (relevant(list[i])) {
            schedule();
            return;
          }
        }
      }).observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-bolt-carousel'] });
    }
  }

  window.__boltRuntime = {
    mode: mode,
    scan: scan,
    show: function (el) {
      var c = carouselOf(el);
      if (c) c.show(el);
    },
  };

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start);
  else start();
})();
