/*
 * HieuSRO native skill icon selector.
 * The actual <select> continues to own the skill IDs and gameplay settings;
 * icons come from OpenSRO's validated Media.pk2 iconPath, never remote art.
 */
import type { SkillMetadata } from '@/engine/foundation/gameplay/skill-catalog';
import { iconPath } from '@/engine/foundation/ui/icon';

function caption(skill: SkillMetadata | undefined, label: string): string {
  if (!skill) return label;
  const extras = [];
  if (Number.isFinite(skill.cooldownMs) && skill.cooldownMs > 0)
    extras.push('Hồi: ' + (skill.cooldownMs / 1000).toFixed(skill.cooldownMs % 1000 ? 1 : 0) + 's');
  if (skill.mp) extras.push('MP: ' + skill.mp);
  if (skill.mpPercent) extras.push('MP: +' + skill.mpPercent + '% tối đa');
  return extras.length ? label + '\n' + extras.join(' • ') : label;
}

function icon(skill: SkillMetadata | undefined, label: string): HTMLElement {
  const holder = document.createElement('span');
  holder.className = 'auto-skill-icon';
  const fallback = document.createElement('span');
  fallback.className = 'auto-icon-fallback';
  fallback.textContent = skill ? (label.trim().slice(0, 2).toLocaleUpperCase() || '?') : '+';
  holder.append(fallback);
  const src = iconPath(skill?.icon);
  if (src) {
    const img = document.createElement('img');
    img.src = src;
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.addEventListener('load', () => { fallback.hidden = true; });
    img.addEventListener('error', () => { img.remove(); fallback.hidden = false; });
    holder.append(img);
  }
  return holder;
}

/**
 * Native <select> remains the source of truth: choosing an icon emits
 * the same change event that the original UI already used to save Skill IDs.
 */
export function createSkillIconPicker(
  select: HTMLSelectElement,
  learned: readonly SkillMetadata[]
): HTMLElement {
  const byId = new Map(learned.map(skill => [skill.id, skill]));
  const container = document.createElement('div');
  container.className = 'auto-icon-picker';
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'auto-icon-trigger';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');

  const grid = document.createElement('div');
  grid.className = 'auto-icon-dropdown';
  grid.hidden = true;
  grid.setAttribute('role', 'group');
  grid.setAttribute('aria-label', 'Chọn kỹ năng đã học');

  const search = document.createElement('input');
  search.className = 'auto-icon-search';
  search.type = 'search';
  search.placeholder = 'Tìm tên kỹ năng...';
  search.setAttribute('aria-label', 'Tìm kỹ năng');
  grid.append(search);

  const choices = document.createElement('div');
  choices.className = 'auto-icon-choices';
  choices.setAttribute('role', 'listbox');
  grid.append(choices);

  const info = document.createElement('p');
  info.className = 'auto-icon-info';
  info.setAttribute('aria-live', 'polite');
  grid.append(info);

  const nativeOptions = [...select.options].map(option => ({
    id: Number(option.value), label: option.textContent?.trim() || 'Skill',
  }));

  function labelFor(id: number): string {
    return nativeOptions.find(row => row.id === id)?.label || 'Không có kỹ năng';
  }
  function current() {
    const id = Number(select.value) || 0;
    const label = labelFor(id);
    trigger.replaceChildren(
      icon(byId.get(id), label),
      Object.assign(document.createElement('span'), {
        className: 'auto-icon-label', textContent: label
      }),
      Object.assign(document.createElement('span'), {
        className: 'auto-icon-chevron', textContent: '▾'
      })
    );
    trigger.title = caption(byId.get(id), label);
    trigger.setAttribute('aria-label', 'Đã chọn: ' + label + '. Nhấn để đổi kỹ năng.');
    for (const child of choices.querySelectorAll<HTMLButtonElement>('button')) {
      const isCurrent = Number(child.dataset.skillId) === id;
      child.classList.toggle('selected', isCurrent);
      child.setAttribute('aria-selected', String(isCurrent));
    }
  }
  function close() {
    grid.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
  }

  for (const row of nativeOptions) {
    const skill = byId.get(row.id);
    const choice = document.createElement('button');
    choice.type = 'button';
    choice.className = 'auto-icon-choice';
    choice.dataset.skillId = String(row.id);
    choice.title = caption(skill, row.label);
    choice.setAttribute('aria-label', row.label);
    choice.setAttribute('role', 'option');
    choice.append(icon(skill, row.label));
    const name = document.createElement('span');
    name.className = 'auto-icon-choice-name';
    name.textContent = row.label;
    choice.append(name);
    choice.addEventListener('mouseenter', () => { info.textContent = caption(skill, row.label); });
    choice.addEventListener('focus', () => { info.textContent = caption(skill, row.label); });
    choice.addEventListener('click', () => {
      select.value = String(row.id);
      select.dispatchEvent(new Event('change', { bubbles: true }));
      current();
      close();
      trigger.focus();
    });
    choices.append(choice);
  }

  search.addEventListener('input', () => {
    const value = search.value.trim().toLocaleLowerCase();
    for (const row of choices.querySelectorAll<HTMLButtonElement>('button')) {
      row.hidden = Boolean(value) && !(row.title || '').toLocaleLowerCase().includes(value);
    }
  });
  trigger.addEventListener('click', () => {
    if (!grid.hidden) { close(); return; }
    // Only one skill list should remain expanded inside the Auto panel.
    const root = container.getRootNode();
    if (root instanceof ShadowRoot) {
      for (const other of root.querySelectorAll<HTMLElement>('.auto-icon-dropdown')) other.hidden = true;
      for (const other of root.querySelectorAll<HTMLButtonElement>('.auto-icon-trigger')) other.setAttribute('aria-expanded', 'false');
    }
    grid.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    search.value = '';
    search.dispatchEvent(new Event('input'));
    info.textContent = trigger.title;
    search.focus();
  });
  grid.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      trigger.focus();
    }
  });
  container.append(trigger, grid);
  current();
  return container;
}
