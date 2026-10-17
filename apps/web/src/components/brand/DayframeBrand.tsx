import Image from "next/image";

type DayframeBrandProps = {
  className?: string;
  decorative?: boolean;
  layout?: "horizontal" | "compact" | "symbol" | "wordmark";
  size?: "sm" | "md" | "lg";
  tone?: "adaptive" | "light" | "dark";
};

export function DayframeBrand({
  className = "",
  decorative = false,
  layout = "horizontal",
  size = "md",
  tone = "adaptive"
}: DayframeBrandProps) {
  return (
    <span
      className={["dayframe-brand", `dayframe-brand-${size}`, className].filter(Boolean).join(" ")}
      data-layout={layout}
      data-tone={tone}
      aria-hidden={decorative ? "true" : undefined}
      aria-label={decorative ? undefined : "Dayframe"}
      role={decorative ? undefined : "img"}
    >
      {layout !== "wordmark" ? (
        // The mark cropped to its blocks (logos/dayframe-colour-mark.svg), so it centres beside the
        // wordmark; its CSS keeps the blocks' size and their distance from the wordmark.
        <Image
          className="dayframe-brand-mark"
          src="/logos/dayframe-colour-mark.svg"
          alt=""
          aria-hidden="true"
          width={655}
          height={685}
          priority
        />
      ) : null}
      {layout !== "symbol" ? (
        <span className="dayframe-brand-wordmark-wrap" aria-hidden="true">
          <Image
            className="dayframe-brand-wordmark dayframe-brand-wordmark-light"
            src="/logos/dayframe-wordmark-light.svg"
            alt=""
            width={1091}
            height={243}
            priority
          />
          <Image
            className="dayframe-brand-wordmark dayframe-brand-wordmark-dark"
            src="/logos/dayframe-wordmark-dark.svg"
            alt=""
            width={1091}
            height={243}
            priority
          />
        </span>
      ) : null}
    </span>
  );
}
