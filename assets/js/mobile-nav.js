/**
 * Mobile navigation — hamburger toggle, overlay, close on link/outside/Escape
 */
(function () {
  function initMobileNav() {
    var btn = document.getElementById('hamburgerBtn');
    var nav = document.getElementById('mobileNav');
    if (!btn || !nav) return;

    var overlay = document.getElementById('mobileNavOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'mobileNavOverlay';
      overlay.className = 'mobile-nav-overlay';
      overlay.setAttribute('aria-hidden', 'true');
      document.body.appendChild(overlay);
    }

    function closeMenu() {
      nav.classList.remove('open');
      btn.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
      nav.setAttribute('aria-hidden', 'true');
      overlay.classList.remove('open');
      overlay.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('mobile-nav-open');
    }

    function openMenu() {
      nav.classList.add('open');
      btn.classList.add('open');
      btn.setAttribute('aria-expanded', 'true');
      nav.setAttribute('aria-hidden', 'false');
      overlay.classList.add('open');
      overlay.setAttribute('aria-hidden', 'false');
      document.body.classList.add('mobile-nav-open');
    }

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (nav.classList.contains('open')) {
        closeMenu();
      } else {
        openMenu();
      }
    });

    overlay.addEventListener('click', closeMenu);

    nav.querySelectorAll('.mobile-nav-item').forEach(function (item) {
      item.addEventListener('click', function () {
        closeMenu();
      });
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.classList.contains('open')) {
        closeMenu();
      }
    });

    window.addEventListener('resize', function () {
      if (window.innerWidth >= 768) {
        closeMenu();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMobileNav);
  } else {
    initMobileNav();
  }
})();
