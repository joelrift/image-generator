'use client';

import { TAG_CATEGORIES, type SceneTags } from '@/lib/prompt-tags';

interface PromptHelperProps {
  tags: SceneTags;
  disabled: boolean;
  onChange: (tags: SceneTags) => void;
}

/**
 * Chip grid for building a prompt by category (lighting, season, weather,
 * setting, people). One choice per category; clicking the selected chip clears
 * it. Selections compose onto the free-text prompt — see composePrompt.
 */
export default function PromptHelper({ tags, disabled, onChange }: PromptHelperProps) {
  const toggle = (categoryKey: string, optionKey: string) => {
    const next = { ...tags };
    if (next[categoryKey] === optionKey) delete next[categoryKey];
    else next[categoryKey] = optionKey;
    onChange(next);
  };

  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
      {TAG_CATEGORIES.map((category) => (
        <section key={category.key} className="flex flex-col gap-2">
          <h3 className="label">{category.label}</h3>
          <div className="flex flex-wrap gap-2">
            {category.options.map((option) => {
              const active = tags[category.key] === option.key;
              return (
                <button
                  key={option.key}
                  type="button"
                  className="pill"
                  data-active={active}
                  aria-pressed={active}
                  disabled={disabled}
                  title={option.phrase}
                  onClick={() => toggle(category.key, option.key)}
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
