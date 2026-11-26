"use client";
import { ExternalLink, Maximize2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { cx } from "./ui";

export type LightboxImage = {
  src: string;
  title?: string;
  subtitle?: string;
};

/** Full-screen enlarged image viewer; Escape closes only the lightbox even over nested modals. */
export function LightboxModal({ image, onClose }: { image: LightboxImage | null; onClose: () => void }) {
  useEffect(() => {
    if (!image) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [image, onClose]);

  if (!image) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex flex-col items-center justify-center bg-black/85 p-4 backdrop-blur-sm fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={image.title ?? "Enlarged image"}
    >
      <div className="absolute right-4 top-4 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        <a
          href={image.src}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-2 text-xs font-medium text-white backdrop-blur hover:bg-white/25"
        >
          <ExternalLink className="size-3.5" /> Open full file
        </a>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close enlarged image"
          className="rounded-full bg-white/90 p-2 text-ink shadow hover:bg-white"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="flex max-h-[88vh] max-w-[94vw] flex-col items-center gap-3" onClick={(e) => e.stopPropagation()}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image.src} alt={image.title ?? "Enlarged view"} className="max-h-[82vh] max-w-[92vw] rounded-xl object-contain shadow-2xl" />
        {(image.title || image.subtitle) && (
          <div className="rounded-full bg-black/60 px-4 py-1.5 text-center text-xs text-white/90 backdrop-blur">
            {image.title && <span className="font-medium">{image.title}</span>}
            {image.title && image.subtitle && <span className="mx-1.5 text-white/50">·</span>}
            {image.subtitle && <span className="text-white/75">{image.subtitle}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

/** Small corner button / indicator showing an image can be clicked to enlarge. */
export function ZoomBadge({ className }: { className?: string }) {
  return (
    <span
      className={cx(
        "pointer-events-none inline-flex items-center justify-center rounded-full bg-black/60 p-1.5 text-white opacity-0 shadow-sm backdrop-blur-sm transition group-hover:opacity-100",
        className,
      )}
    >
      <Maximize2 className="size-3.5" />
    </span>
  );
}

export function useLightbox() {
  const [image, setImage] = useState<LightboxImage | null>(null);
  const openLightbox = useCallback((img: LightboxImage) => setImage(img), []);
  const closeLightbox = useCallback(() => setImage(null), []);
  return {
    openLightbox,
    closeLightbox,
    lightboxNode: <LightboxModal image={image} onClose={closeLightbox} />,
  };
}
