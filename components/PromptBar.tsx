'use client';

interface PromptBarProps {
  prompt: string;
  canGenerate: boolean;
  isGenerating: boolean;
  hasInput: boolean;
  numImages: number;
  imageCount: number;
  onPromptChange: (prompt: string) => void;
  onGenerate: () => void;
}

export default function PromptBar({
  prompt,
  canGenerate,
  isGenerating,
  hasInput,
  numImages,
  imageCount,
  onPromptChange,
  onGenerate,
}: PromptBarProps) {
  /** Cmd/Ctrl+Enter submits — the textarea keeps plain Enter for newlines. */
  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && canGenerate) {
      event.preventDefault();
      onGenerate();
    }
  };

  return (
    <div className="border-t border-line bg-surface p-4">
      <div className="flex flex-col gap-3">
        <label htmlFor="prompt" className="label">
          Prompt
        </label>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <textarea
            id="prompt"
            rows={2}
            value={prompt}
            disabled={isGenerating}
            onChange={(event) => onPromptChange(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe materials, light and mood — e.g. “pine cladding, overcast afternoon, soft shadows”"
            className="min-w-0 flex-1 resize-y rounded border border-line bg-surface px-3 py-2 text-[14px] text-ink outline-none placeholder:text-muted focus:border-accent disabled:opacity-60"
          />
          <button
            type="button"
            onClick={onGenerate}
            disabled={!canGenerate}
            className="btn-primary shrink-0 sm:w-56"
          >
            <span className="block">{isGenerating ? 'Generating…' : 'Generate'}</span>
            <span className="mt-0.5 block font-mono text-[11px] font-normal opacity-80">
              {isGenerating ? 'hold on' : `${numImages} variations · ~1K · ⌘↵`}
            </span>
          </button>
        </div>

        <p className="text-[12px] text-muted">
          {!hasInput
            ? 'Upload a source image first.'
            : imageCount > 0
              ? `${imageCount} images in this session. History clears on refresh — storage arrives in Phase 5.`
              : 'LLM prompt enrichment arrives in Phase 4.'}
        </p>
      </div>
    </div>
  );
}
