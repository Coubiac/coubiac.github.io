// Only the article opting into Mermaid loads this module.
const blocks = [...document.querySelectorAll(
  '.post-body .language-mermaid pre code, .post-body pre > code.language-mermaid'
)];

if (blocks.length) {
  // Keep Kramdown's code blocks as a readable fallback until all diagrams render.
  try {
    const { default: mermaid } = await import('https://cdn.jsdelivr.net/npm/mermaid@12/dist/mermaid.esm.min.mjs');
    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'default' });

    for (const [index, code] of blocks.entries()) {
      const source = code.textContent.trim();
      try {
        const { svg, bindFunctions } = await mermaid.render(`dag-diagram-${index}`, source);
        const container = document.createElement('div');
        container.className = 'mermaid-diagram';
        container.setAttribute('role', 'img');
        container.setAttribute('aria-label', `Schéma ${index + 1} de l'article`);
        container.innerHTML = svg;
        const wrapper = code.parentElement.closest('.language-mermaid') || code.parentElement;
        wrapper.replaceWith(container);
        bindFunctions?.(container);
      } catch (error) {
        console.error('Impossible de rendre un diagramme Mermaid', error);
      }
    }
  } catch (error) {
    console.error('Impossible de charger Mermaid', error);
  }
}
