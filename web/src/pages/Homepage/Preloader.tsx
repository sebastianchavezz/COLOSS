import { useState, useEffect } from "react";

export default function Preloader({ onComplete }: { onComplete: () => void }) {
  const [phase, setPhase] = useState<'dark' | 'light' | 'fadeout' | 'done'>('dark');

  useEffect(() => {
    // Phase 1: Dark -> Light (at 1.5s)
    const lightTimer = setTimeout(() => {
      setPhase('light');
    }, 1500);

    // Phase 2: Light -> Fade out (at 3.5s)
    const fadeTimer = setTimeout(() => {
      setPhase('fadeout');
    }, 3500);

    // Phase 3: Complete (at 5s - after fade animation completes)
    const completeTimer = setTimeout(() => {
      setPhase('done');
      onComplete();
    }, 5000);

    return () => {
      clearTimeout(lightTimer);
      clearTimeout(fadeTimer);
      clearTimeout(completeTimer);
    };
  }, [onComplete]);

  if (phase === 'done') return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{
        backgroundColor: phase === 'dark' ? '#1a1a2e' : '#e8eaed',
        opacity: phase === 'fadeout' ? 0 : 1,
        transition: phase === 'fadeout'
          ? 'opacity 1500ms cubic-bezier(0.4, 0, 0.2, 1)'
          : 'background-color 2000ms cubic-bezier(0.4, 0, 0.2, 1)',
        pointerEvents: phase === 'fadeout' ? 'none' : 'auto',
      }}
    >
      <style>{`
        @keyframes fadeInLogo {
          from { opacity: 0; transform: translate(-50%, -50%) scale(0.95); }
          to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        }
        @keyframes lineGrow {
          0% { transform: scaleX(0); }
          100% { transform: scaleX(1); }
        }
        @keyframes fadeOutContent {
          from { opacity: 1; }
          to { opacity: 0; }
        }

        .preloader-logo {
          animation: fadeInLogo 0.8s ease-out forwards;
          color: #0052ff;
          font-family: "Panchang", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          font-size: clamp(2rem, 8vw, 4rem);
          font-weight: 700;
          letter-spacing: -0.02em;
          text-transform: uppercase;
          text-align: center;
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
        }

        .preloader-line {
          width: 48px;
          height: 2px;
          background-color: #0052ff;
          border-radius: 1px;
          transform-origin: center;
          animation: lineGrow 1.5s ease-in-out 0.4s forwards;
          transform: scaleX(0);
          position: absolute;
          top: 50%;
          left: 50%;
          margin-top: 3.5rem;
          margin-left: -24px;
        }

        .preloader-content {
          transition: opacity 800ms ease-out;
        }

        .preloader-content.fading {
          opacity: 0;
        }
      `}</style>

      <div className={`preloader-content ${phase === 'fadeout' ? 'fading' : ''}`}>
        <h1 className="preloader-logo">
          COLOSS
        </h1>
        <div className="preloader-line" />
      </div>
    </div>
  );
}
