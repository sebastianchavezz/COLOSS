import { Link } from "react-router-dom";
import { Calendar, MapPin, Users } from "lucide-react";

interface EventCardProps {
  id: string;
  title: string;
  organizer: string;
  date: string;
  location: string;
  distance: string;
  participants: number;
  category: "trail" | "road" | "ultra";
}

export function EventCard({
  id,
  title,
  organizer,
  date,
  location,
  distance,
  participants,
  category,
}: EventCardProps) {
  // Color schemes for different event types
  const colorSchemes = {
    trail: {
      bg: "linear-gradient(135deg, #0047FF 0%, #0056FF 100%)",
      text: "#ffffff",
      textMuted: "rgba(255, 255, 255, 0.7)",
      tag: "rgba(255, 255, 255, 0.2)",
      tagText: "#ffffff",
      button: "#C9FF00",
      buttonText: "#0a0a0a",
      pattern: "rgba(255, 255, 255, 0.05)",
    },
    road: {
      bg: "linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 100%)",
      text: "#ffffff",
      textMuted: "rgba(255, 255, 255, 0.6)",
      tag: "rgba(255, 255, 255, 0.15)",
      tagText: "#ffffff",
      button: "#C9FF00",
      buttonText: "#0a0a0a",
      pattern: "rgba(255, 255, 255, 0.03)",
    },
    ultra: {
      bg: "linear-gradient(135deg, #C9FF00 0%, #b8ee00 100%)",
      text: "#0a0a0a",
      textMuted: "rgba(10, 10, 10, 0.6)",
      tag: "rgba(10, 10, 10, 0.1)",
      tagText: "#0a0a0a",
      button: "#0047FF",
      buttonText: "#ffffff",
      pattern: "rgba(10, 10, 10, 0.03)",
    },
  };

  const colors = colorSchemes[category];

  return (
    <Link to={`/event/${id}`} className="block mb-4">
      <article
        className="rounded-2xl overflow-hidden relative transition-transform active:scale-[0.98]"
        style={{ background: colors.bg }}
      >
        {/* Subtle pattern overlay */}
        <div
          className="absolute inset-0 opacity-100"
          style={{
            backgroundImage: `radial-gradient(circle at 20% 50%, ${colors.pattern} 0%, transparent 50%),
                             radial-gradient(circle at 80% 80%, ${colors.pattern} 0%, transparent 50%)`,
          }}
        />

        {/* Content */}
        <div className="relative p-6">
          {/* Category Tag */}
          <div className="mb-4">
            <span
              className="inline-block px-3 py-1 rounded-full text-xs tracking-wider uppercase"
              style={{
                backgroundColor: colors.tag,
                color: colors.tagText,
              }}
            >
              {category}
            </span>
          </div>

          {/* Organizer */}
          <p
            className="text-xs tracking-wide uppercase mb-2"
            style={{ color: colors.textMuted }}
          >
            {organizer}
          </p>

          {/* Title */}
          <h3
            className="text-2xl mb-6 leading-tight tracking-tight"
            style={{ color: colors.text }}
          >
            {title}
          </h3>

          {/* Info Grid */}
          <div className="grid grid-cols-2 gap-3 mb-5">
            <div className="flex items-start gap-2">
              <Calendar
                className="w-4 h-4 flex-shrink-0 mt-0.5"
                style={{ color: colors.textMuted }}
              />
              <span className="text-sm leading-tight" style={{ color: colors.text }}>
                {date}
              </span>
            </div>
            <div className="flex items-start gap-2">
              <MapPin
                className="w-4 h-4 flex-shrink-0 mt-0.5"
                style={{ color: colors.textMuted }}
              />
              <span className="text-sm leading-tight" style={{ color: colors.text }}>
                {location}
              </span>
            </div>
          </div>

          {/* Stats Bar */}
          <div
            className="flex items-center justify-between py-4 mb-4 border-t"
            style={{ borderColor: colors.pattern }}
          >
            <div className="flex items-center gap-6">
              <div>
                <p
                  className="text-xs uppercase tracking-wide mb-1"
                  style={{ color: colors.textMuted }}
                >
                  Distance
                </p>
                <p className="text-lg tracking-tight" style={{ color: colors.text }}>
                  {distance}
                </p>
              </div>
              <div>
                <p
                  className="text-xs uppercase tracking-wide mb-1"
                  style={{ color: colors.textMuted }}
                >
                  Registered
                </p>
                <p className="text-lg tracking-tight" style={{ color: colors.text }}>
                  {participants.toLocaleString()}
                </p>
              </div>
            </div>
          </div>

          {/* CTA Button */}
          <div
            className="w-full py-3.5 rounded-xl text-sm tracking-wide uppercase text-center font-medium"
            style={{
              backgroundColor: colors.button,
              color: colors.buttonText,
            }}
          >
            Register
          </div>
        </div>
      </article>
    </Link>
  );
}