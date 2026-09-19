(() => {
  const toc = document.querySelector("[data-toc]");
  const list = document.querySelector("[data-toc-list]");
  const details = toc?.querySelector("details");
  const headings = Array.from(document.querySelectorAll(".post-body h2, .post-body h3"))
    .filter((heading) => heading.textContent.trim());

  if (!toc || !list || !details || headings.length === 0) return;

  const usedIds = new Set(Array.from(document.querySelectorAll("[id]")).map((element) => element.id));

  const slugify = (value) => value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

  headings.forEach((heading, index) => {
    if (!heading.id) {
      const base = slugify(heading.textContent) || `section-${index + 1}`;
      let candidate = base;
      let suffix = 2;

      while (usedIds.has(candidate)) candidate = `${base}-${suffix++}`;
      heading.id = candidate;
      usedIds.add(candidate);
    }

    const item = document.createElement("li");
    const link = document.createElement("a");

    item.className = `toc-level-${heading.tagName.slice(1)}`;
    link.href = `#${heading.id}`;
    link.textContent = heading.textContent;
    link.dataset.tocTarget = heading.id;
    item.append(link);
    list.append(item);
  });

  const links = Array.from(list.querySelectorAll("a"));
  let frameRequested = false;

  const setActive = (heading) => {
    links.forEach((link) => {
      if (link.dataset.tocTarget === heading.id) {
        link.setAttribute("aria-current", "location");
      } else {
        link.removeAttribute("aria-current");
      }
    });
  };

  const updateActive = () => {
    let active = headings[0];
    headings.forEach((heading) => {
      if (heading.getBoundingClientRect().top <= 180) active = heading;
    });
    setActive(active);
    frameRequested = false;
  };

  const requestUpdate = () => {
    if (frameRequested) return;
    frameRequested = true;
    window.requestAnimationFrame(updateActive);
  };

  const desktop = window.matchMedia("(min-width: 1121px)");
  details.open = desktop.matches;

  links.forEach((link) => {
    link.addEventListener("click", () => {
      if (!desktop.matches) details.open = false;
    });
  });

  toc.hidden = false;
  window.addEventListener("scroll", requestUpdate, { passive: true });
  window.addEventListener("resize", requestUpdate);
  updateActive();
})();
