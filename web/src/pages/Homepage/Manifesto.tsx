import { useEffect, useRef, useState } from "react";

export default function Manifesto() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const [textOpacity, setTextOpacity] = useState(0.6);

  useEffect(() => {
    const handleScroll = () => {
      if (!sectionRef.current) return;

      const rect = sectionRef.current.getBoundingClientRect();
      const windowHeight = window.innerHeight;

      const sectionStart = rect.top;

      if (sectionStart < windowHeight * 0.8) {
        const progress = (windowHeight * 0.8 - sectionStart) / (windowHeight * 0.6);
        const clampedProgress = Math.max(0, Math.min(1, progress));
        const opacity = 0.6 + (clampedProgress * 0.4);
        setTextOpacity(opacity);
      } else {
        setTextOpacity(0.6);
      }
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <section
      id="manifesto"
      ref={sectionRef}
      className="w-full bg-coloss-gray-light py-20 md:py-32"
    >
      <style>{`
        @keyframes fadeInScroll {
          from { opacity: 0; transform: translateY(40px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .manifesto-content.visible { animation: fadeInScroll 0.8s ease-out; }
        .manifesto-text {
          transition: color 0.6s ease-out;
        }
      `}</style>
      <div
        className="w-full mx-auto px-6 md:px-12 lg:px-20 manifesto-content manifesto-text visible"
        style={{ color: `rgba(44, 52, 70, ${textOpacity})` }}
      >
        <h2
          className="font-elegant text-2xl md:text-4xl lg:text-5xl font-light mb-8 md:mb-12 leading-tight tracking-wide italic"
          style={{ opacity: textOpacity, transition: 'opacity 0.6s ease-out' }}
        >
          COLOSS exists as a space between who you are and who you can become.
        </h2>

        <div
          className="font-elegant space-y-6 md:space-y-8 text-lg md:text-xl lg:text-2xl leading-relaxed font-light tracking-wide"
          style={{ opacity: textOpacity * 0.95, transition: 'opacity 0.6s ease-out' }}
        >
          <p>
            As a platform, COLOSS connects people to sport moments they can take
            part in — whether organised by individuals or organisations. Users can
            discover, join, or initiate sport moments without the pressure of
            performance, membership, or long-term commitment. Participation is
            treated as a starting point, not an achievement.
          </p>

          <p>
            COLOSS is built on the belief that sport holds value beyond
            competition. It functions as a shared space where sport exists as
            presence and participation, situated between intention and action, and
            between the individual and the collective.
          </p>
        </div>
      </div>
    </section>
  );
}
