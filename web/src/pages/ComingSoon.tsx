/**
 * Coming Soon Page
 *
 * Aesthetic landing page with rotating background images.
 */

import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";

const backgrounds = [
  "/coming-soon/1.jpg",
  "/coming-soon/2.jpg",
  "/coming-soon/3.jpg",
  "/coming-soon/4.jpg",
];

export function ComingSoon() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [fadeIn, setFadeIn] = useState(true);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const cycleImages = () => {
      // Start fade out
      setFadeIn(false);

      // After fade out, change image and fade in
      timeoutRef.current = setTimeout(() => {
        setActiveIndex((prev) => (prev + 1) % backgrounds.length);
        setFadeIn(true);
      }, 1000);
    };

    // Start the cycle
    const interval = setInterval(cycleImages, 5000);

    return () => {
      clearInterval(interval);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return (
    <div className="fixed inset-0 overflow-hidden bg-black font-heading flex flex-col">
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 0.6; }
          50% { opacity: 1; }
        }
        @keyframes breathing {
          0%, 100% { transform: translate(-50%, -50%) scale(1); }
          50% { transform: translate(-50%, -50%) scale(1.02); }
        }
        .fade-in-1 { animation: fadeIn 0.8s ease-out 0.2s both; }
        .fade-in-2 { animation: fadeIn 0.8s ease-out 0.4s both; }
        .fade-in-3 { animation: fadeIn 0.8s ease-out 0.6s both; }
        .fade-in-4 { animation: fadeIn 0.8s ease-out 0.8s both; }
        .pulse-slow { animation: pulse 3s ease-in-out infinite; }
        .breathing { animation: breathing 4s ease-in-out infinite; }
      `}</style>

      {/* Background Image */}
      <div
        className="absolute inset-0 bg-cover bg-center transition-opacity duration-1000 ease-in-out"
        style={{
          backgroundImage: `url(${backgrounds[activeIndex]})`,
          opacity: fadeIn ? 1 : 0,
        }}
      />

      {/* Dark overlay */}
      <div className="absolute inset-0 bg-black/50" />

      {/* Grain overlay */}
      <div className="absolute inset-0 noise-overlay opacity-20" />

      {/* Main Content Area */}
      <div className="relative z-10 flex-1 flex flex-col">
        {/* Back to home link */}
        <div className="absolute top-0 left-0 p-4 md:p-6">
          <Link
            to="/"
            className="fade-in-1 text-white/60 hover:text-white text-[10px] md:text-xs uppercase tracking-wider transition-colors duration-300"
          >
            ← Back
          </Link>
        </div>

        {/* Progress dots - top right */}
        <div className="fade-in-3 absolute top-0 right-0 p-4 md:p-6 flex gap-2">
          {backgrounds.map((_, index) => (
            <div
              key={index}
              className={`h-1.5 rounded-full transition-all duration-500 ${
                index === activeIndex ? 'bg-white w-4' : 'bg-white/30 w-1.5'
              }`}
            />
          ))}
        </div>

        {/* Centered content */}
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            {/* COLOSS Logo */}
            <h1 className="fade-in-1 text-coloss-blue text-3xl sm:text-4xl md:text-6xl lg:text-7xl font-bold uppercase tracking-tight mb-6">
              COLOSS
            </h1>

            {/* Coming Soon text */}
            <div className="fade-in-2">
              <p className="text-white/80 text-xs md:text-sm uppercase tracking-[0.3em] mb-3">
                Coming Soon
              </p>
              <div className="flex items-center justify-center gap-1.5">
                <span className="w-1.5 h-1.5 bg-coloss-blue rounded-full pulse-slow"></span>
                <span className="w-1.5 h-1.5 bg-coloss-blue rounded-full pulse-slow" style={{ animationDelay: '0.5s' }}></span>
                <span className="w-1.5 h-1.5 bg-coloss-blue rounded-full pulse-slow" style={{ animationDelay: '1s' }}></span>
              </div>
            </div>
          </div>
        </div>

        {/* Tagline above footer */}
        <div className="fade-in-4 text-center pb-4">
          <p className="text-white/40 text-[10px] md:text-xs uppercase tracking-widest">
            The space between who you are and who you can become
          </p>
        </div>
      </div>

      {/* Footer */}
      <footer className="relative z-10 w-full bg-black/80 backdrop-blur-sm py-4 md:py-5 border-t border-white/10">
        <div className="max-w-7xl mx-auto px-6 md:px-8 flex items-center justify-between">
          {/* Left: COLOSS */}
          <div className="text-white/40 text-sm font-normal uppercase tracking-wide">
            COLOSS
          </div>

          {/* Right: Links */}
          <nav className="flex gap-6 md:gap-8 text-[10px] md:text-xs">
            <a
              href="mailto:hello@coloss.com"
              className="text-white/40 hover:text-white transition-colors duration-300 relative group uppercase tracking-wider"
            >
              Contact
              <span className="absolute bottom-0 left-0 w-0 h-px bg-white group-hover:w-full transition-all duration-300" />
            </a>
            <Link
              to="/"
              className="text-white/40 hover:text-white transition-colors duration-300 relative group uppercase tracking-wider"
            >
              Home
              <span className="absolute bottom-0 left-0 w-0 h-px bg-white group-hover:w-full transition-all duration-300" />
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

export default ComingSoon;
