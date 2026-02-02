import { Link } from "react-router-dom";

export default function Footer() {
  return (
    <footer className="w-full bg-black py-8 md:py-6">
      <div className="max-w-7xl mx-auto px-6 md:px-8 flex items-center justify-between">
        {/* Left: COLOSS */}
        <div className="text-red-600 font-heading text-lg font-normal uppercase tracking-wide">
          COLOSS
        </div>

        {/* Right: Links */}
        <nav className="flex gap-8 md:gap-12 text-sm md:text-base">
          <Link
            to="/contact"
            className="text-coloss-muted-gray hover:text-white transition-colors duration-300 relative group"
          >
            Contact
            <span className="absolute bottom-0 left-0 w-0 h-0.5 bg-white group-hover:w-full transition-all duration-300" />
          </Link>
          <Link
            to="/legal"
            className="text-coloss-muted-gray hover:text-white transition-colors duration-300 relative group"
          >
            Legal
            <span className="absolute bottom-0 left-0 w-0 h-0.5 bg-white group-hover:w-full transition-all duration-300" />
          </Link>
        </nav>
      </div>
    </footer>
  );
}
