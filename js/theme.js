import { STORAGE_KEYS } from './config.js';

export function initTheme() {
  const saved = localStorage.getItem(STORAGE_KEYS.theme) || 'light';
  document.documentElement.setAttribute('data-theme', saved);
  updateThemeBtnUI(saved);
}

export function toggleTheme() {
  const cur  = document.documentElement.getAttribute('data-theme') || 'light';
  const next = cur === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem(STORAGE_KEYS.theme, next);
  updateThemeBtnUI(next);
}

export function updateThemeBtnUI(t) {
  const icon = document.getElementById('themeIcon');
  if (icon) icon.innerText = t === 'dark' ? '☀️' : '🌙';
}