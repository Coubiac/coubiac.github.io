(() => {
  const root = document.querySelector("[data-search-root]");
  const input = document.querySelector("[data-search-input]");
  const clearButton = document.querySelector("[data-search-clear]");
  const status = document.querySelector("[data-search-status]");
  const emptyState = document.querySelector("[data-search-empty]");
  const cards = Array.from(document.querySelectorAll("[data-post-card]"));
  const tagButtons = Array.from(document.querySelectorAll("[data-tag]"));

  if (!root || !input || !status || cards.length === 0) return;

  const normalize = (value) => String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

  const params = new URLSearchParams(window.location.search);
  let activeTag = params.get("tag") || "";
  let documents = new Map();

  input.value = params.get("q") || "";

  const fallbackDocument = (card) => ({
    title: card.querySelector("h3")?.textContent || "",
    description: card.textContent || "",
    tags: Array.from(card.querySelectorAll(".tag")).map((tag) => tag.textContent),
    content: ""
  });

  const searchableText = (document) => normalize([
    document.title,
    document.description,
    ...(document.tags || []),
    document.content
  ].join(" "));

  const updateUrl = () => {
    const url = new URL(window.location.href);
    const query = input.value.trim();

    query ? url.searchParams.set("q", query) : url.searchParams.delete("q");
    activeTag ? url.searchParams.set("tag", activeTag) : url.searchParams.delete("tag");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  };

  const applyFilters = () => {
    const terms = normalize(input.value).split(/\s+/).filter(Boolean);
    const normalizedTag = normalize(activeTag);
    let visibleCount = 0;

    cards.forEach((card) => {
      const document = documents.get(card.dataset.postUrl) || fallbackDocument(card);
      const text = searchableText(document);
      const tags = (document.tags || []).map(normalize);
      const matchesQuery = terms.every((term) => text.includes(term));
      const matchesTag = !normalizedTag || tags.includes(normalizedTag);
      const visible = matchesQuery && matchesTag;

      card.hidden = !visible;
      if (visible) visibleCount += 1;
    });

    tagButtons.forEach((button) => {
      button.setAttribute("aria-pressed", String(normalize(button.dataset.tag) === normalizedTag));
    });

    const suffix = visibleCount > 1 ? "s" : "";
    status.textContent = `${visibleCount} article${suffix}`;
    if (emptyState) emptyState.hidden = visibleCount !== 0;
    if (clearButton) clearButton.hidden = !input.value && !activeTag;
    updateUrl();
  };

  input.addEventListener("input", applyFilters);

  tagButtons.forEach((button) => {
    button.addEventListener("click", () => {
      activeTag = normalize(activeTag) === normalize(button.dataset.tag) ? "" : button.dataset.tag;
      applyFilters();
    });
  });

  clearButton?.addEventListener("click", () => {
    input.value = "";
    activeTag = "";
    applyFilters();
    input.focus();
  });

  fetch(root.dataset.indexUrl)
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then((index) => {
      documents = new Map(index.map((document) => [document.url, document]));
      applyFilters();
    })
    .catch(() => applyFilters());

  applyFilters();
})();
