import { useRef, useState } from 'react';
import type { DragEvent, ReactNode } from 'react';

interface DropzoneProps {
  icon: ReactNode;
  accentRingClass: string;
  iconBgClass: string;
  promptText: string;
  browseAccentClass: string;
  subtitle: string;
  hasItems: boolean;
  onFilesSelected: (files: File[]) => void;
  onLoadDemo: () => void;
  onClearAll: () => void;
  footerExtra?: ReactNode;
}

export function Dropzone({
  icon,
  accentRingClass,
  iconBgClass,
  promptText,
  browseAccentClass,
  subtitle,
  hasItems,
  onFilesSelected,
  onLoadDemo,
  onClearAll,
  footerExtra,
}: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer?.files?.length) {
      onFilesSelected(Array.from(e.dataTransfer.files));
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`group relative border-2 border-dashed rounded-xl p-5 text-center bg-white dark:bg-[#0f1624] transition-colors duration-150 cursor-pointer focus-visible:outline-2 focus-visible:outline-blue-500 ${
        isDragging
          ? accentRingClass
          : 'border-slate-300 dark:border-[#2a3752] hover:border-slate-400 dark:hover:border-slate-500'
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) {
            onFilesSelected(Array.from(e.target.files));
            e.target.value = '';
          }
        }}
      />
      <div
        className={`w-11 h-11 mx-auto rounded-xl flex items-center justify-center mb-3 transition-transform duration-150 group-hover:scale-105 ${iconBgClass}`}
      >
        {icon}
      </div>
      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
        {promptText} <span className={`underline ${browseAccentClass}`}>browse</span>
      </p>
      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{subtitle}</p>
      <div className="mt-3.5 flex items-center justify-center gap-2">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onLoadDemo();
          }}
          className="text-xs font-semibold px-3 py-2 rounded-lg bg-slate-100 dark:bg-[#1c263b] hover:bg-slate-200 dark:hover:bg-[#2a3752] text-slate-700 dark:text-slate-200 transition-colors whitespace-nowrap"
        >
          Load Demo Batch (3)
        </button>
        {hasItems && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClearAll();
            }}
            className="text-xs font-semibold px-3 py-2 rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 transition-colors whitespace-nowrap"
          >
            Clear All
          </button>
        )}
      </div>
      {footerExtra}
    </div>
  );
}
