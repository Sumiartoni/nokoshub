/* ================================================
   NOKOSHUB LANDING PAGE - JavaScript
   ================================================ */

document.addEventListener('DOMContentLoaded', () => {

  /* ---- NAVBAR: Scroll effect & active link ---- */
  const navbar = document.getElementById('navbar');
  const sections = document.querySelectorAll('section[id]');
  const navLinks = document.querySelectorAll('.navbar-nav a');
  const hamburger = document.getElementById('hamburger');
  const mobileNav = document.getElementById('mobileNav');
  const mobileClose = document.getElementById('mobileClose');

  window.addEventListener('scroll', () => {
    if (window.scrollY > 50) {
      navbar.classList.add('scrolled');
    } else {
      navbar.classList.remove('scrolled');
    }

    // Active nav link
    let current = '';
    sections.forEach(section => {
      const sectionTop = section.offsetTop - 100;
      if (window.scrollY >= sectionTop) {
        current = section.getAttribute('id');
      }
    });

    navLinks.forEach(link => {
      link.classList.remove('active');
      if (link.getAttribute('href') === `#${current}`) {
        link.classList.add('active');
      }
    });

    // Scroll to top button
    const scrollTopBtn = document.getElementById('scrollTop');
    if (scrollTopBtn) {
      if (window.scrollY > 400) {
        scrollTopBtn.classList.add('visible');
      } else {
        scrollTopBtn.classList.remove('visible');
      }
    }
  });

  /* ---- HAMBURGER MENU ---- */
  if (hamburger && mobileNav) {
    hamburger.addEventListener('click', () => {
      mobileNav.classList.toggle('open');
    });
  }

  if (mobileClose && mobileNav) {
    mobileClose.addEventListener('click', () => {
      mobileNav.classList.remove('open');
    });
  }

  // Close mobile nav on link click
  document.querySelectorAll('.navbar-mobile a').forEach(link => {
    link.addEventListener('click', () => {
      mobileNav.classList.remove('open');
    });
  });

  /* ---- SCROLL TO TOP ---- */
  const scrollTopBtn = document.getElementById('scrollTop');
  if (scrollTopBtn) {
    scrollTopBtn.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  /* ---- ANIMATION ON SCROLL ---- */
  const animatedElems = document.querySelectorAll('.animate-on-scroll');

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const delay = entry.target.dataset.delay || 0;
        setTimeout(() => {
          entry.target.classList.add('visible');
        }, parseInt(delay));
      }
    });
  }, { threshold: 0.12 });

  animatedElems.forEach(el => observer.observe(el));

  /* ---- FAQ ACCORDION ---- */
  const faqItems = document.querySelectorAll('.faq-item');
  faqItems.forEach(item => {
    const question = item.querySelector('.faq-question');
    question.addEventListener('click', () => {
      const isOpen = item.classList.contains('open');
      // Close all
      faqItems.forEach(i => i.classList.remove('open'));
      // Open clicked (if was closed)
      if (!isOpen) {
        item.classList.add('open');
      }
    });
  });

  /* ---- SERVICE FILTER ---- */
  const filterBtns = document.querySelectorAll('.filter-btn');
  const serviceItems = document.querySelectorAll('.service-item');

  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const filter = btn.dataset.filter;
      serviceItems.forEach(item => {
        if (filter === 'all' || item.dataset.category === filter) {
          item.style.display = '';
          item.style.animation = 'bounceIn 0.3s ease';
        } else {
          item.style.display = 'none';
        }
      });
    });
  });

  /* ---- SERVICE SEARCH ---- */
  const searchInput = document.getElementById('serviceSearch');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      const query = searchInput.value.toLowerCase().trim();
      serviceItems.forEach(item => {
        const name = item.querySelector('.service-name').textContent.toLowerCase();
        if (name.includes(query)) {
          item.style.display = '';
        } else {
          item.style.display = 'none';
        }
      });
    });
  }

  /* ---- COUNTER ANIMATION ---- */
  const counters = document.querySelectorAll('.counter-num[data-target]');

  const counterObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const target = parseInt(entry.target.dataset.target);
        const suffix = entry.target.dataset.suffix || '';
        let current = 0;
        const increment = target / 80;
        const timer = setInterval(() => {
          current += increment;
          if (current >= target) {
            current = target;
            clearInterval(timer);
          }
          entry.target.textContent = Math.floor(current).toLocaleString('id-ID') + suffix;
        }, 18);
        counterObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.5 });

  counters.forEach(counter => counterObserver.observe(counter));

  /* ---- TICKER DUPLICATE ---- */
  const tickerInner = document.querySelector('.ticker-inner');
  if (tickerInner) {
    const clone = tickerInner.cloneNode(true);
    tickerInner.parentElement.appendChild(clone);
  }

  /* ---- PRICING TOGGLE (if applicable) ---- */
  // Animated number on hover for pricing cards
  document.querySelectorAll('.pricing-card').forEach(card => {
    card.addEventListener('mouseenter', () => {
      card.style.transform = 'translate(-3px, -3px)';
    });
    card.addEventListener('mouseleave', () => {
      card.style.transform = '';
    });
  });

  /* ---- FLOATING SHAPES PARALLAX ---- */
  const heroShapes = document.querySelectorAll('.hero-shape');
  document.addEventListener('mousemove', (e) => {
    const x = (e.clientX / window.innerWidth - 0.5) * 2;
    const y = (e.clientY / window.innerHeight - 0.5) * 2;

    heroShapes.forEach((shape, i) => {
      const factor = (i + 1) * 4;
      const tx = x * factor;
      const ty = y * factor;
      shape.style.transform = `translate(${tx}px, ${ty}px)`;
    });
  });

  /* ---- TESTIMONIAL HIGHLIGHT ---- */
  const testCards = document.querySelectorAll('.testimonial-card');
  testCards.forEach(card => {
    card.addEventListener('mouseenter', () => {
      testCards.forEach(c => c.style.opacity = '0.6');
      card.style.opacity = '1';
      card.style.transform = 'translate(-3px, -3px)';
      card.style.boxShadow = '7px 7px 0 var(--shadow-color)';
    });
    card.addEventListener('mouseleave', () => {
      testCards.forEach(c => {
        c.style.opacity = '1';
        c.style.transform = '';
        c.style.boxShadow = '';
      });
    });
  });

  /* ---- LIVE SERVICE COUNT ---- */
  // Simulate real-time OTP count
  const liveCount = document.getElementById('liveOtpCount');
  if (liveCount) {
    let count = parseInt(liveCount.textContent.replace(/[^0-9]/g, ''));
    setInterval(() => {
      count += Math.floor(Math.random() * 3) + 1;
      liveCount.textContent = count.toLocaleString('id-ID');
    }, 2500);
  }

  /* ---- INIT ---- */
  console.log('🚀 NokosHUB Landing Page initialized!');
});
