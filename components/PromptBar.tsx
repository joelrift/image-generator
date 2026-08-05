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
            placeholder="Beskriv materialer, lys og stemning — f.eks. «trekledning i furu, overskyet ettermiddag, myk skygge»"
            className="min-w-0 flex-1 resize-y rounded border border-line bg-surface px-3 py-2 text-[14px] text-ink outline-none placeholder:text-muted focus:border-accent disabled:opacity-60"
          />
          <button
            type="button"
            onClick={onGenerate}
            disabled={!canGenerate}
            className="btn-primary shrink-0 sm:w-56"
          >
            <span className="block">{isGenerating ? 'Genererer…' : 'Generer'}</span>
            <span className="mt-0.5 block font-mono text-[11px] font-normal opacity-80">
              {isGenerating ? 'vent litt' : `${numImages} varianter · ~1K · ⌘↵`}
            </span>
          </button>
        </div>

        <p className="text-[12px] text-muted">
          {!hasInput
            ? 'Last opp et underlag først.'
            : imageCount > 0
              ? `${imageCount} bilder i denne økten. Historikken forsvinner ved refresh — lagring kommer i Fase 5.`
              : 'Promptforbedring med språkmodell kommer i Fase 4.'}
        </p>
      </div>
    </div>
  );
}
