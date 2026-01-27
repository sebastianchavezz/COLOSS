import { Search, SlidersHorizontal } from "lucide-react";

export function MobileHeader() {
  return (
    <header className="sticky top-0 z-10 bg-white border-b border-[rgba(0,0,0,0.08)]">
      {/* iOS Status Bar Spacer */}
      <div className="h-11 bg-white" />

      {/* Main Header */}
      <div className="px-5 pb-3">
        {/* Logo and Actions */}
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl tracking-tight text-[#0a0a0a]">
            <span className="text-[#0047FF]">COLOSS</span>
          </h1>
          <div className="flex items-center gap-3">
            <button
              className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-[#f5f5f5] active:bg-[#ebebeb] transition-colors"
              aria-label="Search"
            >
              <Search className="w-5 h-5 text-[#0a0a0a]" />
            </button>
            <button
              className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-[#f5f5f5] active:bg-[#ebebeb] transition-colors"
              aria-label="Filters"
            >
              <SlidersHorizontal className="w-5 h-5 text-[#0a0a0a]" />
            </button>
          </div>
        </div>

        {/* Category Pills */}
        <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-5 px-5">
          <button className="flex-shrink-0 px-4 py-2 bg-[#0a0a0a] text-white rounded-full text-sm transition-colors">
            All Events
          </button>
          <button className="flex-shrink-0 px-4 py-2 bg-[#f5f5f5] text-[#0a0a0a] rounded-full text-sm hover:bg-[#ebebeb] transition-colors">
            Trail Running
          </button>
          <button className="flex-shrink-0 px-4 py-2 bg-[#f5f5f5] text-[#0a0a0a] rounded-full text-sm hover:bg-[#ebebeb] transition-colors">
            Road
          </button>
          <button className="flex-shrink-0 px-4 py-2 bg-[#f5f5f5] text-[#0a0a0a] rounded-full text-sm hover:bg-[#ebebeb] transition-colors">
            Ultra
          </button>
          <button className="flex-shrink-0 px-4 py-2 bg-[#f5f5f5] text-[#0a0a0a] rounded-full text-sm hover:bg-[#ebebeb] transition-colors">
            This Month
          </button>
        </div>
      </div>
    </header>
  );
}
