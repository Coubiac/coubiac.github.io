(() => {
  const root = document.querySelector("[data-search-root]");
  const input = document.querySelector("[data-search-input]");
  const clearButton = document.querySelector("[data-search-clear]");
  const status = document.querySelector("[data-search-status]");
  const emptyState = document.querySelector("[data-search-empty]");
  const cards = Array.from(document.querySelectorAll("[data-post-card]"));
  const tagButtons = Array.from(document.querySelectorAll("[data-tag]"));
  const typeButtons = Array.from(document.querySelectorAll("[data-type]"));
  const featuredSection = document.querySelector("[data-featured-section]");
  const browseAll = document.querySelector("[data-browse-all]");
  const listHeading = document.querySelector("[data-list-heading]");

  if (!root || !input || !status || cards.length === 0) return;

  const normalize = (value) => String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

  const params = new URLSearchParams(window.location.search);
  let activeTags = Array.from(new Set(params.getAll("tag").filter(Boolean)));
  let activeType = params.get("type") || "";
  const showAll = params.get("all") === "1";
  let documents = new Map();

  input.value = params.get("q") || "";

  const fallbackDocument = (card) => ({
    title: card.querySelector("h3")?.textContent || "",
    description: card.querySelector(".post-card-description")?.textContent || "",
    tags: Array.from(card.querySelectorAll(".tag")).map((tag) => tag.textContent),
    content: "",
    type: card.dataset.postType || ""
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
    if (query) url.searchParams.set("q", query);
    else url.searchParams.delete("q");

    url.searchParams.delete("tag");
    activeTags.forEach((tag) => url.searchParams.append("tag", tag));

    if (activeType) url.searchParams.set("type", activeType);
    else url.searchParams.delete("type");

    if (showAll && !query && activeTags.length === 0 && !activeType) {
      url.searchParams.set("all", "1");
    } else {
      url.searchParams.delete("all");
    }
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
  };

  const applyFilters = () => {
    const terms = normalize(input.value).split(/\s+/).filter(Boolean);
    const normalizedTags = activeTags.map(normalize);
    const filtering = terms.length > 0 || normalizedTags.length > 0 || Boolean(activeType);
    let matchedCount = 0;
    let visibleCount = 0;

    cards.forEach((card) => {
      const document = documents.get(card.dataset.postUrl) || fallbackDocument(card);
      const allTags = (document.tags || []).map(normalize);
      const matchesQuery = terms.every((term) => searchableText(document).includes(term));
      const matchesTags = normalizedTags.every((tag) => allTags.includes(tag));
      const matchesType = !activeType || (document.type || card.dataset.postType) === activeType;
      const matches = matchesQuery && matchesTags && matchesType;
      if (matches) matchedCount += 1;

      const visible = matches && (filtering || showAll || card.dataset.defaultVisible === "true");
      card.hidden = !visible;
      if (visible) visibleCount += 1;
    });

    tagButtons.forEach((button) => {
      button.setAttribute("aria-pressed", String(normalizedTags.includes(normalize(button.dataset.tag))));
    });
    typeButtons.forEach((button) => {
      button.setAttribute("aria-pressed", String(activeType === button.dataset.type));
    });

    if (featuredSection) featuredSection.hidden = filtering || showAll;
    if (browseAll) browseAll.hidden = filtering || showAll;
    if (listHeading) {
      listHeading.textContent = filtering ? "Résultats de recherche" : (showAll ? "Tous les articles" : "Articles récents");
    }

    status.textContent = filtering
      ? matchedCount + " article" + (matchedCount > 1 ? "s" : "") + " trouvé" + (matchedCount > 1 ? "s" : "")
      : visibleCount + " article" + (visibleCount > 1 ? "s" : "") + " affiché" + (visibleCount > 1 ? "s" : "");
    if (emptyState) emptyState.hidden = !filtering || matchedCount !== 0;
    if (clearButton) clearButton.hidden = !filtering;
    updateUrl();
  };

  input.addEventListener("input", applyFilters);

  tagButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const tag = button.dataset.tag;
      const exists = activeTags.some((active) => normalize(active) === normalize(tag));
      activeTags = exists
        ? activeTags.filter((active) => normalize(active) !== normalize(tag))
        : [...activeTags, tag];
      applyFilters();
    });
  });

  typeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      activeType = activeType === button.dataset.type ? "" : button.dataset.type;
      applyFilters();
    });
  });

  clearButton?.addEventListener("click", () => {
    input.value = "";
    activeTags = [];
    activeType = "";
    applyFilters();
    input.focus();
  });

  fetch(root.dataset.indexUrl)
    .then((response) => {
      if (!response.ok) throw new Error("HTTP " + response.status);
      return response.json();
    })
    .then((index) => {
      documents = new Map(index.map((document) => [document.url, document]));
      applyFilters();
    })
    .catch(() => applyFilters());

  applyFilters();
})();