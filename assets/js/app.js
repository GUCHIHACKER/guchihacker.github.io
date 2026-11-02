const app = document.getElementById('app');
const posts = fetch('/posts.json').then(r => r.json());

const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const tags = t => t.map(x => `<a class="tag" href="/?tag=${encodeURIComponent(x)}">#${esc(x)}</a>`).join(' ');
const item = p => `<li><time>${p.date}</time> <a href="/?p=${p.slug}">${esc(p.title)}</a> ${tags(p.tags)}</li>`;
const sorted = async () => (await posts).sort((a, b) => b.date.localeCompare(a.date));
async function list(tag) {
  const all = await sorted();
  // Tags Whitelist
  if (tag !== undefined && !all.some(p => p.tags.includes(tag))) return notFound('category not found');
  const items = all.filter(p => !tag || p.tags.includes(tag));
  document.title = tag ? `#${tag} · guchi` : 'home · guchi';
  app.innerHTML = (tag ? `<h2>#${esc(tag)}</h2>` : '<h2>posts</h2>') +`<ul class="posts">${items.map(item).join('')}</ul>`;
}

async function search() {
  const all = await sorted();
  document.title = 'search · guchi';
  app.innerHTML = '<input id="q" placeholder="search by title or tag…"><ul class="posts"></ul>';
  const q = document.getElementById('q'), ul = app.querySelector('.posts');
  q.oninput = () => {
    const s = q.value.toLowerCase().trim();
    ul.innerHTML = s ? all.filter(p => (p.title + ' ' + p.tags.join(' ')).toLowerCase().includes(s)).map(item).join('') : '';
  };
  q.focus();
}

async function post(slug) {
  const p = (await posts).find(p => p.slug === slug);
  if (!p) return notFound();
  const md = await fetch(`/posts/${slug}.md`).then(r => r.text());
  document.title = `${p.title} · guchi`;
  app.innerHTML = `<article><h1>${esc(p.title)}</h1><p class="meta"><time>${p.date}</time> ${tags(p.tags)}</p>${marked.parse(md)}</article>`;
  app.querySelectorAll('pre code').forEach(el => hljs.highlightElement(el));
  // Table of contents from ## and ###
  const heads = [...app.querySelectorAll('article h2, article h3')];
  heads.forEach(h => h.id = h.textContent.toLowerCase().replace(/[^\w]+/g, '-').replace(/^-|-$/g, ''));
  if (heads.length) app.insertAdjacentHTML('beforeend', '<nav id="toc">' +
    heads.map(h => `<a class="${h.tagName.toLowerCase()}" href="#${h.id}">${esc(h.textContent)}</a>`).join('') + '</nav>');
  if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
}

async function about() {
  document.title = 'about · guchi';
  app.innerHTML = marked.parse(await fetch('/about.md').then(r => r.text()));
}

function notFound(msg = 'not found') {
  document.title = 'not found · guchi';
  app.innerHTML = `<p>404 — ${msg}</p>`;
}

// Highlight the sidebar link for the current page
const mark = () => document.querySelectorAll('aside nav a').forEach(a => a.classList.toggle('active', a.href === location.href));

let page;
function render() {
  page = location.pathname + location.search;
  mark();
  const q = new URLSearchParams(location.search);
  if (q.has('p')) return post(q.get('p'));
  if (q.has('tag')) return list(q.get('tag'));
  if (q.has('about')) return about();
  if (q.has('search')) return search();
  return list();
}

// Internal links change the URL without reloading the page
document.addEventListener('click', e => {
  const a = e.target.closest('a');
  if (!a || a.origin !== location.origin || a.hash || a.pathname !== '/' || e.ctrlKey || e.metaKey) return;
  e.preventDefault();
  history.pushState(null, '', a.href);
  render();
  scrollTo(0, 0);
  if (innerWidth < 900) document.body.classList.remove('toggled');
});
// Jumping to a #section also fires popstate: only re-render if the page changed
addEventListener('popstate', () => page !== location.pathname + location.search && render());
document.getElementById('toggle').onclick = () => document.body.classList.toggle('toggled');

// Sidebar categories: every tag with its post count, most used first
posts.then(all => {
  const count = {};
  all.forEach(p => p.tags.forEach(t => count[t] = (count[t] || 0) + 1));
  document.getElementById('cats').insertAdjacentHTML('beforeend', Object.entries(count)
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `<a href="/?tag=${encodeURIComponent(t)}">#${esc(t)} <span>(${n})</span></a>`).join(''));
  mark();
});
render();
