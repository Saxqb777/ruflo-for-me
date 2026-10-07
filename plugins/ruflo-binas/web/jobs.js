// The Factory panel: new job form, job cards, answer controls. Talks to the local server's job board
// (/api/jobs, /api/answer). Hidden when the page is not served from loopback, since the cloud board comes later.
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = (n) => '$' + Number(n || 0).toFixed(2);
const MARK = { queued: '·', running: '▸', blocked: '!', answered: '▸', done: '✓', shipped: '✓', failed: '×' };

export function createJobs({ section, form, list, status, enabled, onJobs }) {
  let jobs = [], timer = null;
  if (!enabled) { section.hidden = true; return { jobs: () => [], question: () => null, answer: async () => {}, refresh: async () => {}, stop() {} }; }

  async function refresh() {
    try { const r = await fetch('/api/jobs', { cache: 'no-store' }); if (!r.ok) throw new Error(r.status); jobs = (await r.json()).jobs || []; render(); if (onJobs) onJobs(jobs); }
    catch { status.textContent = 'job board unreachable'; }
  }
  async function answer(jobId, text) {
    const r = await fetch('/api/answer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jobId, text }) });
    const j = await r.json().catch(() => ({})); if (!r.ok) { status.textContent = j.error || 'answer refused'; return false; }
    status.textContent = 'answered · the workshop resumes it'; await refresh(); return true;
  }
  function question(jobId) { const j = jobs.find((x) => x.id === jobId); return j && j.state === 'blocked' ? j.question : null; }

  function render() {
    list.replaceChildren();
    if (!jobs.length) { const d = document.createElement('div'); d.className = 'none'; d.textContent = 'no jobs yet. Describe what to build above, then run the workshop: binas run'; list.appendChild(d); return; }
    for (const j of jobs.slice().reverse()) {
      const card = document.createElement('div'); card.className = 'jobcard st-' + j.state;
      const links = [j.links && j.links.pr ? `<a href="${esc(j.links.pr)}" target="_blank" rel="noopener">pull request</a>` : '', j.links && j.links.preview ? `<a href="${esc(j.links.preview)}" target="_blank" rel="noopener">preview</a>` : '', j.links && j.links.remote && !j.links.pr ? `<a href="${esc(j.links.remote)}" target="_blank" rel="noopener">repo</a>` : ''].filter(Boolean).join(' · ');
      card.innerHTML = `<div class="jh"><span class="jm">${MARK[j.state] || '·'}</span><span class="jt"></span><span class="js">${esc(j.state)}</span></div>
        <div class="jmeta mono">${esc(j.branch)} · ${money(j.costUsd)} · ${j.turns || 0} turns${j.project ? ' · ' + esc(j.project.kind) : ''}</div>
        ${j.summary && j.summary.summary ? `<div class="jsum"></div>` : ''}${links ? `<div class="jlinks">${links}</div>` : ''}${j.error ? `<div class="jerr"></div>` : ''}
        ${j.state === 'blocked' && j.question ? `<div class="jq"><div class="jqt"></div><div class="jopts"></div><form class="jans"><input type="text" placeholder="or type an answer" aria-label="Answer"><button type="submit">Send</button></form></div>` : ''}`;
      card.querySelector('.jt').textContent = j.title;
      if (j.summary && j.summary.summary) card.querySelector('.jsum').textContent = j.summary.summary;
      if (j.error) card.querySelector('.jerr').textContent = j.error;
      if (j.state === 'blocked' && j.question) {
        card.querySelector('.jqt').textContent = j.question.text;
        const opts = card.querySelector('.jopts'); (j.question.options || []).forEach((o) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = o; b.onclick = () => answer(j.id, o); opts.appendChild(b); });
        card.querySelector('.jans').addEventListener('submit', (e) => { e.preventDefault(); const v = e.target.querySelector('input').value.trim(); if (v) answer(j.id, v); });
      }
      list.appendChild(card);
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(form); const body = { title: f.get('title'), brief: f.get('brief'), project: f.get('project') || undefined, ship: f.get('ship'), budgetUsd: f.get('budget') };
    status.textContent = 'queuing…';
    const r = await fetch('/api/jobs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { status.textContent = j.error || 'refused'; return; }
    status.textContent = `queued ${j.id} · start the workshop with: binas run`; form.reset(); refresh();
  });
  refresh(); timer = setInterval(refresh, 3000);
  return { jobs: () => jobs, question, answer, refresh, stop() { clearInterval(timer); } };
}
