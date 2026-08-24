'use client';

import { TAG_CATEGORIES, type SceneTags, type TagCategory } from '@/lib/prompt-tags';

interface PromptHelperProps {
  tags: SceneTags;
  disabled: boolean;
  onChange: (tags: SceneTags) => void;
}

/**
 * Chip grid for building a prompt by category (materials, lighting, season,
 * weather, setting, people). Most groups are single-choice; the multi groups
 * (materials) allow several. Clicking a selected chip clears it. Selections
 * compose onto the free-text prompt — see composePrompt.
 */
export default function PromptHelper({ tags, disabled, onChange }: PromptHelperProps) {
  const toggle = (category: TagCategory, optionKey: string) => {
    const next = { ...tags };
    if (category.multi) {
      const current = next[category.key];
      const chosen = Array.isArray(current) ? [...current] : [];
      const at = chosen.indexOf(optionKey);
      if (at >= 0) chosen.splice(at, 1);
      else chosen.push(optionKey);
      if (chosen.length) next[category.key] = chosen;
      else delete next[category.key];
    } else if (next[category.key] === optionKey) {
      delete next[category.key];
    } else {
      next[category.key] = optionKey;
    }
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-4">
      {TAG_CATEGORIES.map((category) => (
        <section key={category.key} className="flex flex-col gap-2">
          <h3 className="label">{category.label}</h3>
          <div className="flex flex-wrap gap-2">
            {category.options.map((option) => {
              const selected = tags[category.key];
              const active = Array.isArray(selected)
                ? selected.includes(option.key)
                : selected === option.key;
              return (
                <button
                  key={option.key}
                  type="button"
                  className="pill"
                  data-active={active}
                  aria-pressed={active}
                  disabled={disabled}
                  title={option.phrase}
                  onClick={() => toggle(category, option.key)}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
