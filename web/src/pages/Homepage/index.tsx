/**
 * Homepage Component
 *
 * COLOSS Premium Homepage with cinematic preloader and hero section.
 */

import { useState } from "react";
import Preloader from "./Preloader";
import Hero from "./Hero";
import Manifesto from "./Manifesto";
import Footer from "./Footer";

export function Homepage() {
  const [preloaderComplete, setPreloaderComplete] = useState(false);

  return (
    <div className="bg-white font-heading">
      {!preloaderComplete && (
        <Preloader onComplete={() => setPreloaderComplete(true)} />
      )}
      <Hero />
      <Manifesto />
      <Footer />
    </div>
  );
}

export default Homepage;
