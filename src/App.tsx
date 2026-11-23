import { useCallback, useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import type { ConverterSection, ToastMessage, ToastType } from './types/converter';
import { JpegConverter } from './components/JpegConverter';
import { PngConverter } from './components/PngConverter';
import { SvgConverter } from './components/SvgConverter';
import { ToastContainer } from './components/ToastContainer';
import { VideoConverter } from './components/VideoConverter';

const TABS: Array<{ id: ConverterSection; label: string; activeClass: string }> = [
  {
    id: 'png',
    label: '1. Transparent PNG',
    activeClass: 'bg-blue-600 text-white',
  },
  {
    id: 'jpeg',
    label: '2. JPEG Images',
    activeClass: 'bg-indigo-600 text-white',
  },
  {
    id: 'svg',
    label: '3. Vectors (SVG)',
    activeClass: 'bg-purple-600 text-white',
  },
  {
    id: 'video',
    label: '4. Videos',
    activeClass: 'bg-rose-600 text-white',
  },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<ConverterSection>('png');
  const [isDark, setIsDark] = useState<boolean>(true);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [isDark]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3600);
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 dark:bg-[#090d16] dark:text-slate-100">
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      <header className="sticky top-0 z-40 backdrop-blur-md bg-white/90 dark:bg-[#0f1624]/90 border-b border-slate-200 dark:border-[#1c263b]">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4 lg:gap-8">
          {/* Zone 1: Single-line Brand Wordmark */}
          <span className="text-base sm:text-lg font-extrabold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0">
            StockStudio Pro
          </span>

          {/* Zone 2: Primary Converter Section Navigation */}
          <nav
            aria-label="Converter Sections"
            className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1"
          >
            {TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`px-3.5 py-2 rounded-lg text-xs sm:text-sm font-semibold whitespace-nowrap shrink-0 transition-colors duration-150 ${
                    isActive
                      ? tab.activeClass
                      : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-[#1c263b]'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: Primary Action (Theme Switch) */}
          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={() => setIsDark((prev) => !prev)}
              aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              className="p-2.5 rounded-lg bg-slate-100 dark:bg-[#1c263b] hover:bg-slate-200 dark:hover:bg-[#2a3752] text-slate-700 dark:text-slate-200 transition-colors shrink-0"
            >
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <section className={activeTab === 'png' ? 'block' : 'hidden'} aria-hidden={activeTab !== 'png'}>
          <PngConverter onToast={showToast} />
        </section>

        <section className={activeTab === 'jpeg' ? 'block' : 'hidden'} aria-hidden={activeTab !== 'jpeg'}>
          <JpegConverter onToast={showToast} />
        </section>

        <section className={activeTab === 'svg' ? 'block' : 'hidden'} aria-hidden={activeTab !== 'svg'}>
          <SvgConverter onToast={showToast} />
        </section>

        <section className={activeTab === 'video' ? 'block' : 'hidden'} aria-hidden={activeTab !== 'video'}>
          <VideoConverter onToast={showToast} />
        </section>
      </main>
    </div>
  );
}
