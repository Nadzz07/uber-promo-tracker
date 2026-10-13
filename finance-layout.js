const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths = {
  savings: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v5c0 4 16 4 16 0V5M4 10v5c0 4 16 4 16 0v-5M4 15v4c0 4 16 4 16 0v-4"/>',
  wallet: '<path d="M20 8V5H5a3 3 0 0 0 0 6h16v10H5a3 3 0 0 1-3-3V8M21 12h-6v6h6"/><path d="M17 15h.01"/>',
  bag: '<path d="M5 7h14l1 14H4L5 7Z"/><path d="M8 8V6a4 4 0 0 1 8 0v2"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 2v6M17 2v6M3 11h18M7 15h2M15 15h2"/>',
  receipt: '<path d="M6 2h9l4 4v16H5V2h1ZM14 2v5h5M8 11h8M8 15h8M8 19h5"/>',
  chart: '<path d="M4 21V12h3v9M11 21V3h3v18M18 21V8h3v13"/>',
  shield: '<path d="m12 2 9 4v6c0 5-5 9-9 11-4-2-9-6-9-11V6l9-4Z"/><path d="m8 12 3 3 5-6"/>',
  history: '<path d="M3 5v5h5M3 10a9 9 0 1 1 1 8M12 7v6l4 2"/>',
  lock: '<rect x="5" y="10" width="14" height="12" rx="3"/><path d="M8 10V6a4 4 0 0 1 8 0v4M12 15v3"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  insights: '<path d="M4 21V15h3v6M11 21V9h3v12M18 21V3h3v18"/>',
  user: '<circle cx="12" cy="7" r="4"/><path d="M4 22v-3a8 8 0 0 1 16 0v3"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="16" cy="17" r="3"/>',
  help: '<path d="M3 3c3-1 6 0 9 2 3-2 6-3 9-2v17c-3-1-6 0-9 2-3-2-6-3-9-2V3Z"/><path d="M12 5v17"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  ignored: '<path d="m3 3 18 18M10 5c6-1 10 7 10 7a19 19 0 0 1-3 4M6 6a20 20 0 0 0-4 6s4 7 10 7c2 0 3-1 4-2"/><path d="M9 9a4 4 0 0 0 6 6"/>',
  partial: '<circle cx="12" cy="12" r="9"/><path d="M12 3v9h9"/>',
  alert: '<path d="m12 3 10 18H2L12 3ZM12 9v5M12 17h.01"/>',
  star: '<path d="m12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1 3-6Z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>'
};
export function financeIcon(name) {
  return '<svg class="finance-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'+(paths[name] || paths.receipt)+'</svg>';
}
export function financeHero(label, value, detail) {
  return '<div class="savings-hero finance-hero"><div class="finance-hero-heading"><span class="finance-icon-surface">'+financeIcon('savings')+'</span><span class="savings-hero-label">'+escape(label)+'</span></div><div class="savings-hero-value">'+escape(value)+'</div><p class="finance-confirmation">'+financeIcon('check')+escape(detail)+'</p></div>';
}
export function financeMetric(icon, label, value, detail = '', target = null) {
  const tag = target ? 'button' : 'div';
  const attributes = target ? ' type="button" '+(target.local ? 'data-finance-open="'+escape(target.panel)+'"' : 'data-open-sheet="finance" data-finance-target="'+escape(target.panel)+'"')+(target.missing ? ' data-finance-missing="true"' : '') : '';
  return '<'+tag+' class="insight'+(target ? ' metric-action' : '')+'"'+attributes+'>'+financeIcon(icon)+'<span class="insight-label">'+escape(label)+'</span><span class="insight-value">'+escape(value)+'</span>'+(detail ? '<span class="sheet-help">'+escape(detail)+(target ? ' ›' : '')+'</span>' : '')+'</'+tag+'>';
}
