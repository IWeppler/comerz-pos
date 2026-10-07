"use client";

import Marquee from "react-fast-marquee";

interface AnnouncementBarProps {
  isActive: boolean;
  text: string;
}

export function AnnouncementBar({
  isActive,
  text,
}: Readonly<AnnouncementBarProps>) {
  if (!isActive || !text) return null;

  return (
    <div className="bg-foreground text-background font-bold text-[10px] sm:text-xs uppercase tracking-[0.2em] py-2.5 z-30 overflow-hidden flex items-center">
      <Marquee gradient={false} speed={40} autoFill={true} pauseOnHover={true}>
        {/* Le damos un buen margen lateral (mx-8) para que cuando se duplique el texto no quede pegado */}
        <span className="mx-8">{text}</span>
      </Marquee>
    </div>
  );
}
