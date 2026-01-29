import { Link } from "react-router-dom";

interface HeroProps {
  onNavigate?: (section: string) => void;
}

export default function Hero({ onNavigate }: HeroProps) {
  return (
    <section className="relative w-full h-screen min-h-screen overflow-hidden bg-black">
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes fadeInDown {
          from { opacity: 0; transform: translateY(-20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes breathing {
          0%, 100% { transform: translate(-50%, -50%) scale(1); }
          50% { transform: translate(-50%, -50%) scale(1.03); }
        }
        .hero-logo {
          animation: fadeIn 0.6s ease-out forwards, breathing 4s ease-in-out 1s infinite;
        }
        .hero-nav { animation: fadeInDown 0.6s ease-out 0.2s both; }
        .hero-cta { animation: fadeInUp 0.6s ease-out 0.4s both; }
        .hero-cta:active { transform: scale(0.98) translate(-50%, -50%); }
      `}</style>

      {/* Background image */}
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{
          backgroundImage:
            "url('https://cdn.builder.io/api/v1/image/assets%2F36699070d2554b67a54c277c6391ee97%2F8049e61495b04a7e861a73eb9d1936ed?format=webp&width=1400&height=1800')",
        }}
      />

      {/* Cinematic gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/70" />

      {/* Color grading overlay */}
      <div className="absolute inset-0 bg-gradient-to-r from-orange-950/20 via-transparent to-red-950/20" />

      {/* Vignette effect */}
      <div className="absolute inset-0 shadow-inner" style={{
        boxShadow: 'inset 0 0 120px rgba(0, 0, 0, 0.5), inset 0 0 60px rgba(139, 69, 19, 0.3)'
      }} />

      {/* Film grain overlay */}
      <div className="absolute inset-0 noise-overlay opacity-10" />

      {/* Content */}
      <div className="relative z-10 w-full h-screen">
        {/* Navigation - Top */}
        <nav
          className="hero-nav absolute top-0 left-0 right-0 flex justify-center md:justify-between items-center px-5 md:px-8 py-3 md:py-4 gap-4 md:gap-0"
          style={{ zIndex: 11 }}
        >
          {/* Left - About us (hidden on mobile, shown on md+) */}
          <a
            href="#manifesto"
            onClick={() => onNavigate?.("about")}
            className="hidden md:block text-coloss-offwhite hover:text-white transition-colors duration-300 relative group text-xs font-medium uppercase tracking-wider font-heading"
          >
            About us
            <span className="absolute bottom-0 left-0 w-0 h-px bg-coloss-offwhite group-hover:w-full transition-all duration-300" />
          </a>

          {/* Mobile: centered row of all links */}
          <div className="flex md:hidden items-center gap-6 text-[10px]">
            <a
              href="#manifesto"
              onClick={() => onNavigate?.("about")}
              className="text-coloss-offwhite hover:text-white transition-colors duration-300 relative group font-medium uppercase tracking-wider font-heading"
            >
              About
              <span className="absolute bottom-0 left-0 w-0 h-px bg-coloss-offwhite group-hover:w-full transition-all duration-300" />
            </a>
            <Link
              to="/coming-soon"
              className="text-coloss-offwhite hover:text-white transition-colors duration-300 relative group font-medium uppercase tracking-wider font-heading"
            >
              Organizers
              <span className="absolute bottom-0 left-0 w-0 h-px bg-coloss-offwhite group-hover:w-full transition-all duration-300" />
            </Link>
            <Link
              to="/coming-soon"
              className="text-coloss-offwhite hover:text-white transition-colors duration-300 relative group font-medium uppercase tracking-wider font-heading"
            >
              Sporters
              <span className="absolute bottom-0 left-0 w-0 h-px bg-coloss-offwhite group-hover:w-full transition-all duration-300" />
            </Link>
          </div>

          {/* Right - For organizers & For sporters (hidden on mobile, shown on md+) */}
          <div className="hidden md:flex items-center gap-6 text-xs">
            <Link
              to="/coming-soon"
              className="text-coloss-offwhite hover:text-white transition-colors duration-300 relative group font-medium uppercase tracking-wider font-heading"
            >
              For organizers
              <span className="absolute bottom-0 left-0 w-0 h-px bg-coloss-offwhite group-hover:w-full transition-all duration-300" />
            </Link>
            <Link
              to="/coming-soon"
              className="text-coloss-offwhite hover:text-white transition-colors duration-300 relative group font-medium uppercase tracking-wider font-heading"
            >
              For sporters
              <span className="absolute bottom-0 left-0 w-0 h-px bg-coloss-offwhite group-hover:w-full transition-all duration-300" />
            </Link>
          </div>
        </nav>

        {/* Logo - FIXED position (DO NOT CHANGE) */}
        <h1
          className="hero-logo font-heading font-bold text-coloss-blue text-center uppercase tracking-tight md:tracking-tighter"
          style={{
            fontSize: 'clamp(2rem, 8vw, 4rem)',
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 10
          }}
        >
          COLOSS
        </h1>

        {/* CTA Button - Bottom */}
        <div
          className="hero-cta absolute bottom-0 left-0 right-0 flex justify-center pb-10 md:pb-12"
          style={{ zIndex: 11 }}
        >
          <Link
            to="/coming-soon"
            className="px-6 py-2.5 md:px-8 md:py-3 border border-coloss-offwhite text-coloss-offwhite rounded-sm hover:border-white hover:text-white hover:bg-white/5 transition-all duration-300 text-[10px] md:text-xs font-medium tracking-wider text-center uppercase"
          >
            Discover sport moments
          </Link>
        </div>
      </div>
    </section>
  );
}
